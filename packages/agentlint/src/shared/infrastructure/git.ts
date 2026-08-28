/**
 * Git repository comparisons.
 *
 * Change rules compare the merge base of a selected ref and `HEAD` with the
 * current working tree. The current side includes committed, staged,
 * unstaged, and untracked content.
 *
 * @module
 * @since 0.2.0
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import type { ChangeHunk, ChangeLine, ChangeSet, ChangedFile, FileSnapshot } from "../../domain/rule.js";

/** @since 0.2.0 @category errors */
export class GitError extends Schema.TaggedError<GitError>()("agentlint/GitError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Git ${this.operation} failed: ${this.detail}`;
  }
}

const parseNulSeparated = (output: string): ReadonlyArray<string> =>
  output.split("\0").filter((entry) => entry.length > 0);

/** `git show <ref>:<path>` reports a missing path with one of these messages. */
const MISSING_PATH_PATTERN = /does not exist in|exists on disk, but not in/;

const normalizePath = (value: string): string => value.replace(/\\/g, "/");

const digest = (content: string): string => createHash("sha256").update(content).digest("hex");

const snapshot = (content: string): FileSnapshot => ({ content, digest: digest(content) });

const gitCommand = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          ["-c", "core.fsmonitor=false", ...args],
          { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true },
          (error, stdout, stderr) => {
            if (error) reject(new Error(stderr.trim() || error.message));
            else resolve(stdout);
          },
        );
      }),
    catch: (error) => error,
  });

interface NameStatus {
  readonly status: ChangedFile["status"];
  readonly path: string;
  readonly previousPath?: string | undefined;
}

export function parseGitNameStatus(output: string): ReadonlyArray<NameStatus> {
  const tokens = output.split("\0").filter((token) => token.length > 0);
  const files: NameStatus[] = [];

  for (let index = 0; index < tokens.length;) {
    const code = tokens[index++] ?? "";
    const kind = code[0];
    if (kind === "R" || kind === "C") {
      const previousPath = tokens[index++];
      const path = tokens[index++];
      if (previousPath && path) {
        files.push({ status: "renamed", previousPath: normalizePath(previousPath), path: normalizePath(path) });
      }
      continue;
    }

    const path = tokens[index++];
    if (!path) continue;
    const status: ChangedFile["status"] = kind === "A" ? "added" : kind === "D" ? "deleted" : "modified";
    files.push({ status, path: normalizePath(path) });
  }

  return files;
}

export function parseUnifiedHunks(output: string): ReadonlyArray<ChangeHunk> {
  const hunks: ChangeHunk[] = [];
  let current: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: ChangeLine[] } | null =
    null;

  for (const line of output.split(/\r?\n/)) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      if (current) hunks.push(current);
      current = {
        oldStart: Number(header[1]),
        oldLines: Number(header[2] ?? "1"),
        newStart: Number(header[3]),
        newLines: Number(header[4] ?? "1"),
        lines: [],
      };
      continue;
    }
    if (!current || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) current.lines.push({ kind: "addition", content: line.slice(1) });
    else if (line.startsWith("-")) current.lines.push({ kind: "deletion", content: line.slice(1) });
    else if (line.startsWith(" ")) current.lines.push({ kind: "context", content: line.slice(1) });
  }

  if (current) hunks.push(current);
  return hunks;
}

/** @since 0.2.0 */
export class Git extends Context.Service<
  Git,
  {
    detectDefaultBranch(): Effect.Effect<string, GitError>;
    /** Paths that exist in the working tree and differ from the merge base. Deleted paths are excluded. */
    changedFiles(baseRef?: string): Effect.Effect<ReadonlyArray<string>, GitError>;
    changeSet(baseRef?: string): Effect.Effect<ChangeSet, GitError>;
  }
>()("agentlint/Git") {
  static readonly layer: Layer.Layer<Git, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    Git,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const runRaw = (operation: string, args: ReadonlyArray<string>) =>
        gitCommand(env.cwd, args).pipe(Effect.mapError((error) => new GitError({ operation, detail: String(error) })));

      const run = (operation: string, args: ReadonlyArray<string>) =>
        runRaw(operation, args).pipe(Effect.map((value) => value.trim()));
      let repositoryPrefix: string | undefined;
      const prefix = () =>
        repositoryPrefix !== undefined
          ? Effect.succeed(repositoryPrefix)
          : run("repository prefix", ["rev-parse", "--show-prefix"]).pipe(
              Effect.tap((value) => Effect.sync(() => (repositoryPrefix = value))),
            );

      const existsRef = (ref: string) =>
        run("reference lookup", ["rev-parse", "--verify", "--quiet", ref]).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );

      const detectDefaultBranch = () =>
        run("default branch detection", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).pipe(
          Effect.catch(() =>
            Effect.gen(function* () {
              for (const candidate of ["origin/main", "main", "origin/master", "master"]) {
                if (yield* existsRef(candidate)) return candidate;
              }
              return yield* new GitError({ operation: "default branch detection", detail: "no default branch found" });
            }),
          ),
        );

      const resolveBaseline = (baseRef?: string) =>
        Effect.gen(function* () {
          const ref = baseRef ?? (yield* detectDefaultBranch());
          const commit = yield* run("merge-base", ["merge-base", "HEAD", ref]);
          if (!commit) {
            return yield* new GitError({ operation: "merge-base", detail: `no merge base for HEAD and ${ref}` });
          }
          return { ref, commit } as const;
        });

      /** Read a file at `ref`. A path absent from `ref` is `undefined`; other failures propagate. */
      const showFile = (ref: string, filePath: string): Effect.Effect<string | undefined, GitError> =>
        prefix().pipe(
          Effect.flatMap((projectPrefix) =>
            runRaw("file read", ["show", `${ref}:${projectPrefix}${normalizePath(filePath)}`]),
          ),
          Effect.map((content): string | undefined => content),
          Effect.catchIf(
            (error) => MISSING_PATH_PATTERN.test(error.detail),
            () => Effect.succeed(undefined),
          ),
        );

      const readWorkingFile = (filePath: string) =>
        fs.readFileString(path.resolve(env.cwd, filePath)).pipe(
          Effect.map((content): string | undefined => content),
          Effect.catch(() => Effect.succeed(undefined)),
        );

      const collectStatus = (baseCommit: string) =>
        Effect.gen(function* () {
          const tracked = parseGitNameStatus(
            yield* run("changed file collection", [
              "diff",
              "--relative",
              "--name-status",
              "-z",
              "--find-renames",
              baseCommit,
              "--",
            ]),
          );
          const trackedPaths = new Set(tracked.map((entry) => entry.path));
          const untracked = parseNulSeparated(
            yield* runRaw("untracked file collection", ["ls-files", "--others", "--exclude-standard", "-z"]),
          );
          return [
            ...tracked,
            ...untracked
              .map(normalizePath)
              .filter((file) => !trackedPaths.has(file))
              .map((file): NameStatus => ({ status: "added", path: file })),
          ].toSorted((left, right) => left.path.localeCompare(right.path));
        });

      const changeSet = (baseRef?: string) =>
        Effect.gen(function* () {
          const baseline = yield* resolveBaseline(baseRef);
          const statuses = yield* collectStatus(baseline.commit);
          const files: ChangedFile[] = [];

          for (const entry of statuses) {
            const beforePath = entry.previousPath ?? entry.path;
            const beforeContent = entry.status === "added" ? undefined : yield* showFile(baseline.commit, beforePath);
            const afterContent = entry.status === "deleted" ? undefined : yield* readWorkingFile(entry.path);
            const diff = yield* runRaw("diff generation", [
              "diff",
              "--relative",
              "--no-ext-diff",
              "--unified=3",
              "--find-renames",
              baseline.commit,
              "--",
              beforePath,
              ...(entry.previousPath ? [entry.path] : []),
            ]);
            const parsedHunks = parseUnifiedHunks(diff);
            const hunks =
              parsedHunks.length === 0 && entry.status === "added" && afterContent !== undefined
                ? [
                    {
                      oldStart: 0,
                      oldLines: 0,
                      newStart: 1,
                      newLines: afterContent.split(/\r?\n/).length,
                      lines: afterContent.split(/\r?\n/).map((content) => ({ kind: "addition" as const, content })),
                    },
                  ]
                : parsedHunks;

            files.push({
              status: entry.status,
              path: entry.path,
              ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
              before: beforeContent === undefined ? null : snapshot(beforeContent),
              after: afterContent === undefined ? null : snapshot(afterContent),
              hunks: [...hunks],
            });
          }

          return {
            baseline: { kind: "git" as const, ref: baseline.ref, commit: baseline.commit },
            files,
          };
        });

      const changedFiles = (baseRef?: string) =>
        Effect.gen(function* () {
          const baseline = yield* resolveBaseline(baseRef);
          const statuses = yield* collectStatus(baseline.commit);
          return statuses.filter((entry) => entry.status !== "deleted").map((entry) => entry.path);
        });

      return Git.of({ detectDefaultBranch, changedFiles, changeSet });
    }),
  );
}
