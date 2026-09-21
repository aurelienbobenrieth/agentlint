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
import { textLines } from "../pipeline/change-hunks.js";
import { inspectRepositoryEntry, toRepositoryPath } from "../pipeline/file-resolver.js";
import { Env } from "../../config/env.js";
import { compareStrings } from "../../domain/compare.js";
import type { ChangeHunk, ChangeLine, ChangeSet, ChangedFile, FileSnapshot } from "../../domain/rule.js";
import { normalizeLineEndings } from "../../domain/source-text.js";

/** Largest Git output and largest working file loaded into a snapshot. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** @since 0.2.0 @category errors */
export class GitError extends Schema.TaggedError<GitError>()("agentlint/GitError", {
  reason: Schema.Literals([
    "command",
    "executable_missing",
    "output_too_large",
    "unsafe_ref",
    "no_merge_base",
    "shallow_clone",
    "no_default_branch",
  ]),
  operation: Schema.String,
  detail: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
}) {
  override get message(): string {
    switch (this.reason) {
      case "command":
        return `Git ${this.operation} failed: ${this.detail}`;
      case "executable_missing":
        return `Git ${this.operation} failed: git is not installed or not on PATH`;
      case "output_too_large":
        return `Git ${this.operation} failed: the output exceeds ${MAX_BUFFER_BYTES} bytes`;
      case "unsafe_ref":
        return `Git reference must not start with "-": ${this.ref}`;
      case "no_merge_base":
        return `No merge base for HEAD and ${this.ref}. Pass --base with a ref that shares history with HEAD.`;
      case "shallow_clone":
        return `No merge base for HEAD and ${this.ref}: this is a shallow clone. Fetch full history (actions/checkout fetch-depth: 0) or pass --base.`;
      case "no_default_branch":
        return `No default branch found (tried ${this.detail}). Pass --base <ref> or set "base" in .agentlint/config.ts.`;
    }
  }
}

const DEFAULT_BRANCH_CANDIDATES = ["origin/main", "main", "origin/master", "master"] as const;

const GITLINK_MODE = "160000";

const NULL_BLOB = /^0+$/;

const parseNulSeparated = (output: string): ReadonlyArray<string> =>
  output.split("\0").filter((entry) => entry.length > 0);

const digest = (content: string): string => createHash("sha256").update(content).digest("hex");

/** Line endings are normalized once here, so a CRLF checkout and an LF checkout carry the same evidence. */
const snapshot = (content: string): FileSnapshot => {
  const normalized = normalizeLineEndings(content);
  return { content: normalized, digest: digest(normalized) };
};

/** A file too large or too binary to load keeps its identity and drops its content. */
const unloadedSnapshot = (blob: string): FileSnapshot => ({ digest: `git-blob:${blob}` });

/** Git's own heuristic: a NUL in the first 8000 bytes. */
const isBinary = (content: string): boolean => content.slice(0, 8000).includes("\0");

interface CommandFailure {
  readonly exitCode: number | undefined;
  readonly code: string | undefined;
  readonly detail: string;
}

const gitCommand = (
  cwd: string,
  args: ReadonlyArray<string>,
  literalPathspecs: boolean,
  variables?: Readonly<NodeJS.ProcessEnv>,
) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          [
            "-c",
            "core.fsmonitor=false",
            "-c",
            "color.ui=false",
            "-c",
            "diff.algorithm=myers",
            "-c",
            "diff.indentHeuristic=false",
            // A read-only tool must not take the index lock from a concurrent commit.
            "--no-optional-locks",
            // `pages/[id].tsx` is one file, not a character class.
            ...(literalPathspecs ? ["--literal-pathspecs"] : []),
            ...args,
          ],
          {
            cwd,
            encoding: "utf8",
            maxBuffer: MAX_BUFFER_BYTES,
            windowsHide: true,
            signal,
            timeout: 120_000,
            env: variables ? { ...variables, LANG: "C", LC_ALL: "C" } : undefined,
          },
          (error, stdout, stderr) => {
            if (!error) return resolve(stdout);
            reject({
              exitCode: typeof error.code === "number" ? error.code : undefined,
              code: typeof error.code === "string" ? error.code : undefined,
              detail: stderr.trim() || error.message,
            } satisfies CommandFailure);
          },
        );
      }),
    catch: (failure) => failure as CommandFailure,
  });

/** Exit status 1 is Git's "no"; every other failure is a real one. */
const answersNo = (error: GitError): boolean => error.reason === "command" && error.exitCode === 1;

interface StatusEntry {
  readonly status: ChangedFile["status"];
  readonly path: string;
  readonly previousPath?: string | undefined;
  readonly beforeMode: string;
  readonly afterMode: string;
  /** Blob of the baseline side. All zeros when the baseline has none or Git did not resolve it. */
  readonly beforeBlob: string;
}

/**
 * Parse `git diff --raw -z --abbrev=40`. Git separates with `/` on every platform, so paths pass through verbatim:
 * a backslash is part of a file name.
 */
export function parseGitRawStatus(output: string): ReadonlyArray<StatusEntry> {
  const tokens = output.split("\0").filter((token) => token.length > 0);
  const files: StatusEntry[] = [];

  for (let index = 0; index < tokens.length;) {
    const header = /^:(\d{6}) (\d{6}) ([0-9a-f]+) [0-9a-f]+ ([A-Z])/.exec(tokens[index++] ?? "");
    if (!header) continue;
    const [, beforeMode = "", afterMode = "", beforeBlob = "", kind] = header;
    if (kind === "R" || kind === "C") {
      const previousPath = tokens[index++];
      const path = tokens[index++];
      if (previousPath && path)
        files.push({ status: "renamed", previousPath, path, beforeMode, afterMode, beforeBlob });
      continue;
    }

    const path = tokens[index++];
    if (!path) continue;
    const status: ChangedFile["status"] = kind === "A" ? "added" : kind === "D" ? "deleted" : "modified";
    files.push({ status, path, beforeMode, afterMode, beforeBlob });
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

/** One side of a changed file: loaded text, an identity without content, or nothing agentlint may read. */
type SideContent =
  | { readonly _tag: "Text"; readonly content: string }
  | { readonly _tag: "Unloaded"; readonly blob: string }
  | { readonly _tag: "Skipped" };

/** @since 0.2.0 */
export class Git extends Context.Service<
  Git,
  {
    detectDefaultBranch(): Effect.Effect<string, GitError>;
    /** Paths that exist in the working tree and differ from the merge base. Deleted paths are excluded. */
    changedFiles(baseRef?: string): Effect.Effect<ReadonlyArray<string>, GitError>;
    /**
     * The normalized comparison. `include` is applied to the changed paths before any content is read or diffed, so an
     * ignored or out-of-scope file costs nothing. Submodule entries are never part of a change set.
     */
    changeSet(baseRef?: string, include?: (path: string) => boolean): Effect.Effect<ChangeSet, GitError>;
    /**
     * Tracked and unignored untracked paths below the working directory. `undefined` when Git cannot list them: no
     * Git, no work tree, or a working directory the enclosing repository ignores.
     */
    readonly listFiles?: (() => Effect.Effect<ReadonlyArray<string> | undefined, GitError>) | undefined;
  }
>()("agentlint/Git") {
  static readonly layer: Layer.Layer<Git, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    Git,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const runRaw = (operation: string, args: ReadonlyArray<string>, literalPathspecs = true) =>
        gitCommand(env.cwd, args, literalPathspecs, env.variables).pipe(
          Effect.mapError(
            (failure) =>
              new GitError({
                reason:
                  failure.code === "ENOENT"
                    ? "executable_missing"
                    : failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                      ? "output_too_large"
                      : "command",
                operation,
                detail: failure.detail,
                exitCode: failure.exitCode,
              }),
          ),
        );

      const run = (operation: string, args: ReadonlyArray<string>, literalPathspecs = true) =>
        runRaw(operation, args, literalPathspecs).pipe(Effect.map((value) => value.trim()));

      let repositoryPrefix: string | undefined;
      const prefix = () =>
        repositoryPrefix !== undefined
          ? Effect.succeed(repositoryPrefix)
          : run("repository prefix", ["rev-parse", "--show-prefix"]).pipe(
              Effect.tap((value) => Effect.sync(() => (repositoryPrefix = value))),
            );

      const safeRef = (ref: string) =>
        ref.startsWith("-")
          ? Effect.fail(new GitError({ reason: "unsafe_ref", operation: "reference lookup", ref }))
          : Effect.succeed(ref);

      const existsRef = (ref: string) =>
        run("reference lookup", ["rev-parse", "--verify", "--quiet", ref]).pipe(
          Effect.as(true),
          Effect.catchIf(answersNo, () => Effect.succeed(false)),
        );

      const detectDefaultBranch = () =>
        run("default branch detection", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).pipe(
          Effect.catchIf(answersNo, () =>
            Effect.gen(function* () {
              for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
                if (yield* existsRef(candidate)) return candidate;
              }
              return yield* new GitError({
                reason: "no_default_branch",
                operation: "default branch detection",
                detail: ["origin/HEAD", ...DEFAULT_BRANCH_CANDIDATES].join(", "),
              });
            }),
          ),
        );

      const resolveBaseline = (baseRef?: string) =>
        Effect.gen(function* () {
          const ref = yield* safeRef(baseRef ?? (yield* detectDefaultBranch()));
          const commit = yield* run("merge-base", ["merge-base", "HEAD", ref]).pipe(
            Effect.catchIf(
              (error) => error.reason === "command",
              (error) =>
                Effect.gen(function* () {
                  const shallow = yield* run("shallow clone detection", ["rev-parse", "--is-shallow-repository"]);
                  if (shallow === "true")
                    return yield* new GitError({ reason: "shallow_clone", operation: "merge-base", ref });
                  return yield* answersNo(error)
                    ? new GitError({ reason: "no_merge_base", operation: "merge-base", ref })
                    : error;
                }),
            ),
          );
          if (!commit) return yield* new GitError({ reason: "no_merge_base", operation: "merge-base", ref });
          return { ref, commit } as const;
        });

      /** The baseline blob of `filePath`, or `undefined` when the baseline has no such path. */
      const baselineBlob = (commit: string, entry: StatusEntry): Effect.Effect<string | undefined, GitError> => {
        if (entry.status === "added") return Effect.succeed(undefined);
        if (!NULL_BLOB.test(entry.beforeBlob)) return Effect.succeed(entry.beforeBlob);
        // Git leaves the blob unresolved for an unmerged path. Ask by name; the exit status answers, not the message.
        return prefix().pipe(
          Effect.flatMap((projectPrefix) =>
            run("baseline lookup", [
              "rev-parse",
              "--verify",
              "--quiet",
              `${commit}:${projectPrefix}${entry.previousPath ?? entry.path}`,
            ]),
          ),
          Effect.map((blob): string | undefined => blob),
          Effect.catchIf(answersNo, () => Effect.succeed(undefined)),
        );
      };

      const readBaseline = (commit: string, entry: StatusEntry): Effect.Effect<SideContent | undefined, GitError> =>
        Effect.gen(function* () {
          const blob = yield* baselineBlob(commit, entry);
          if (blob === undefined) return undefined;
          return yield* runRaw("file read", ["cat-file", "blob", blob]).pipe(
            Effect.map((content): SideContent =>
              isBinary(content) ? { _tag: "Unloaded", blob } : { _tag: "Text", content },
            ),
            Effect.catchIf(
              (error) => error.reason === "output_too_large",
              () => Effect.succeed<SideContent>({ _tag: "Unloaded", blob }),
            ),
          );
        });

      /** Read the working side without following a link: a symbolic link is its target text, as Git stores it. */
      const readWorkingFile = (root: string, filePath: string): Effect.Effect<SideContent, GitError> =>
        Effect.gen(function* () {
          const entry = yield* inspectRepositoryEntry(fs, path, root, filePath);
          if (entry._tag !== "Missing" && entry.linkTarget !== undefined)
            return { _tag: "Text", content: toRepositoryPath(entry.linkTarget, path.sep) } as const;
          if (entry._tag !== "Inside") return { _tag: "Skipped" } as const;
          const info = yield* fs.stat(entry.realPath);
          if (info.type !== "File") return { _tag: "Skipped" } as const;
          const content = Number(info.size) > MAX_BUFFER_BYTES ? undefined : yield* fs.readFileString(entry.realPath);
          if (content !== undefined && !isBinary(content)) return { _tag: "Text", content } as const;
          return { _tag: "Unloaded", blob: yield* run("file hash", ["hash-object", "--", filePath]) } as const;
        }).pipe(
          Effect.mapError((error) =>
            error instanceof GitError
              ? error
              : new GitError({
                  reason: "command",
                  operation: "working file read",
                  detail: `${filePath}: ${error.message}`,
                }),
          ),
        );

      const toSnapshot = (side: SideContent | undefined): FileSnapshot | null =>
        side === undefined || side._tag === "Skipped"
          ? null
          : side._tag === "Text"
            ? snapshot(side.content)
            : unloadedSnapshot(side.blob);

      const collectStatus = (baseCommit: string) =>
        Effect.gen(function* () {
          const tracked = parseGitRawStatus(
            yield* runRaw("changed file collection", [
              "diff",
              "--relative",
              "--raw",
              "--abbrev=40",
              "-z",
              "--find-renames",
              baseCommit,
              "--",
            ]),
            // A submodule is a commit pointer, not a file: it has no content to snapshot or scan.
          ).filter((entry) => entry.beforeMode !== GITLINK_MODE && entry.afterMode !== GITLINK_MODE);
          const trackedPaths = new Set(tracked.map((entry) => entry.path));
          const untracked = parseNulSeparated(
            yield* runRaw("untracked file collection", ["ls-files", "--others", "--exclude-standard", "-z"]),
          );
          return {
            untracked: new Set(untracked),
            entries: [
              ...tracked,
              ...untracked
                // Git reports an untracked nested repository as a directory.
                .filter((file) => !trackedPaths.has(file) && !file.endsWith("/"))
                .map((file): StatusEntry => ({
                  status: "added",
                  path: file,
                  beforeMode: "000000",
                  afterMode: "100644",
                  beforeBlob: "0",
                })),
            ].toSorted((left, right) => compareStrings(left.path, right.path)),
          };
        });

      const changeSet = (baseRef?: string, include?: (path: string) => boolean) =>
        Effect.gen(function* () {
          const baseline = yield* resolveBaseline(baseRef);
          const root = yield* fs
            .realPath(env.cwd)
            .pipe(
              Effect.mapError(
                (error) =>
                  new GitError({ reason: "command", operation: "working directory lookup", detail: error.message }),
              ),
            );
          const { entries, untracked } = yield* collectStatus(baseline.commit);
          const selected = include
            ? entries.filter(
                (entry) => include(entry.path) || (entry.previousPath !== undefined && include(entry.previousPath)),
              )
            : entries;
          const files = yield* Effect.forEach(
            selected,
            (entry) =>
              Effect.gen(function* () {
                const before = yield* readBaseline(baseline.commit, entry);
                const after = entry.status === "deleted" ? undefined : yield* readWorkingFile(root, entry.path);
                if (after?._tag === "Skipped") return undefined;
                const loaded = before?._tag !== "Unloaded" && after?._tag !== "Unloaded";
                // An untracked file has no diff, and an unloaded side has none worth its size.
                const parsedHunks =
                  untracked.has(entry.path) || !loaded
                    ? []
                    : parseUnifiedHunks(
                        yield* runRaw("diff generation", [
                          "diff",
                          "--relative",
                          "--no-ext-diff",
                          "--no-textconv",
                          "--unified=3",
                          "--find-renames",
                          baseline.commit,
                          "--",
                          entry.previousPath ?? entry.path,
                          ...(entry.previousPath ? [entry.path] : []),
                        ]).pipe(
                          Effect.catchIf(
                            (error) => error.reason === "output_too_large",
                            () => Effect.succeed(""),
                          ),
                        ),
                      );
                const hunks =
                  parsedHunks.length === 0 && entry.status === "added" && after?._tag === "Text"
                    ? [
                        {
                          oldStart: 0,
                          oldLines: 0,
                          newStart: 1,
                          newLines: textLines(after.content).length,
                          lines: textLines(after.content).map((content) => ({ kind: "addition" as const, content })),
                        },
                      ]
                    : parsedHunks;

                return {
                  status: entry.status,
                  path: entry.path,
                  ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
                  before: toSnapshot(before),
                  after: toSnapshot(after),
                  hunks: [...hunks],
                } satisfies ChangedFile;
              }),
            { concurrency: 4 },
          );

          return {
            baseline: { kind: "git" as const, ref: baseline.ref, commit: baseline.commit },
            files: files.filter((file) => file !== undefined),
          };
        });

      const changedFiles = (baseRef?: string) =>
        Effect.gen(function* () {
          const baseline = yield* resolveBaseline(baseRef);
          const { entries } = yield* collectStatus(baseline.commit);
          return entries.filter((entry) => entry.status !== "deleted").map((entry) => entry.path);
        });

      const listFiles = () =>
        Effect.gen(function* () {
          const inside = yield* run("work tree detection", ["rev-parse", "--is-inside-work-tree"]).pipe(
            Effect.catchIf(
              (error) => error.reason === "command" || error.reason === "executable_missing",
              () => Effect.succeed("false"),
            ),
          );
          if (inside !== "true") return undefined;
          // Below an ignored directory (a project inside a dotfiles repository) Git lists nothing at all.
          // `check-ignore` rejects literal pathspecs, and `.` has nothing to escape.
          const ignored = yield* run("ignore lookup", ["check-ignore", "--quiet", "."], false).pipe(
            Effect.as(true),
            Effect.catchIf(answersNo, () => Effect.succeed(false)),
          );
          if (ignored) return undefined;
          return parseNulSeparated(
            yield* runRaw("file listing", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
          );
        });

      return Git.of({ detectDefaultBranch, changedFiles, changeSet, listFiles });
    }),
  );
}
