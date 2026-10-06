/**
 * Git repository comparisons.
 *
 * Change rules compare the merge base of a selected ref and `HEAD` with the current working tree. The current side
 * includes committed, staged, unstaged, and untracked content.
 *
 * @module
 * @since 0.2.0
 */

import { createHash } from "node:crypto";
import { Context, Effect, FileSystem, Layer, Match, Path, Schema } from "effect";
import { Env } from "../../../config/env.js";
import { compareStrings } from "../../../domain/compare.js";
import type { ChangeSet, ChangedFile, FileSnapshot } from "../../../domain/rule/model.js";
import { normalizeLineEndings, textLines } from "../../../domain/source-text.js";
import { inspectRepositoryEntry, toRepositoryPath } from "../repository/entry/service.js";
import { GIT_MAX_BUFFER_BYTES, readGitObjects, runGitCommand, type GitCommandFailure } from "./command.js";
import { parseGitRawStatus, parseUnifiedHunks, splitPatches, type StatusEntry } from "./parsing.js";

export { parseGitRawStatus, parseUnifiedHunks } from "./parsing.js";

/**
 * @since 0.2.0 @category errors
 */
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
    return {
      command: `Git ${this.operation} failed: ${this.detail}`,
      executable_missing: `Git ${this.operation} failed: git is not installed or not on PATH`,
      output_too_large: `Git ${this.operation} failed: the output exceeds ${GIT_MAX_BUFFER_BYTES} bytes`,
      unsafe_ref: `Git reference must not start with "-": ${this.ref}`,
      no_merge_base: `No merge base for HEAD and ${this.ref}. Pass --base with a ref that shares history with HEAD.`,
      shallow_clone: `No merge base for HEAD and ${this.ref}: this is a shallow clone. Fetch full history (actions/checkout fetch-depth: 0) or pass --base.`,
      no_default_branch: `No default branch found (tried ${this.detail}). Pass --base <ref> or set "base" in .agentlint/config.ts.`,
    }[this.reason];
  }
}

const DEFAULT_BRANCH_CANDIDATES = ["origin/main", "main", "origin/master", "master"] as const;

const GITLINK_MODE = "160000";

const NULL_BLOB = /^0+$/;

/**
 * Characters of paths passed to one Git process. Windows caps a command line at 32,767 characters.
 */
const PATH_ARGUMENTS_PER_PROCESS = 16_000;

/**
 * Split `paths` into runs whose command line stays under the Windows limit, each run keeping at least one path.
 */
const pathChunks = <A>(items: ReadonlyArray<A>, pathOf: (item: A) => string): ReadonlyArray<ReadonlyArray<A>> => {
  const chunks: A[][] = [];
  const current: { items: A[]; length: number } = { items: [], length: 0 };
  for (const item of items) {
    // Quotes and a separator around each argument.
    const length = pathOf(item).length + 3;
    if (current.items.length > 0 && current.length + length > PATH_ARGUMENTS_PER_PROCESS) {
      chunks.push(current.items);
      current.items = [];
      current.length = 0;
    }
    current.items.push(item);
    current.length += length;
  }
  if (current.items.length > 0) chunks.push(current.items);
  return chunks;
};

const parseNulSeparated = (output: string): ReadonlyArray<string> =>
  output.split("\0").filter((entry) => entry.length > 0);

const digest = (content: string): string => createHash("sha256").update(content).digest("hex");

/**
 * Line endings are normalized once here, so a CRLF checkout and an LF checkout carry the same evidence.
 */
const snapshot = (content: string): FileSnapshot => {
  const normalized = normalizeLineEndings(content);
  return { content: normalized, digest: digest(normalized) };
};

/**
 * A file too large or too binary to load keeps its identity and drops its content.
 */
const unloadedSnapshot = (blob: string): FileSnapshot => ({ digest: `git-blob:${blob}` });

/**
 * Git's own heuristic: a NUL in the first 8000 bytes.
 */
const isBinary = (content: string): boolean => content.slice(0, 8000).includes("\0");

/**
 * Exit status 1 is Git's "no"; every other failure is a real one.
 */
const answersNo = (error: GitError): boolean => error.reason === "command" && error.exitCode === 1;

/**
 * One side of a changed file: loaded text, an identity without content, or nothing agentlint may read.
 */
type SideContent =
  | { readonly _tag: "Text"; readonly content: string }
  | { readonly _tag: "Unloaded"; readonly blob: string }
  | { readonly _tag: "Skipped" };

/**
 * @since 0.2.0
 */
const safeRef = (ref: string) =>
  ref.startsWith("-")
    ? Effect.fail(new GitError({ reason: "unsafe_ref", operation: "reference lookup", ref }))
    : Effect.succeed(ref);

const toSnapshot = (side: SideContent | undefined): FileSnapshot | null =>
  side === undefined || side._tag === "Skipped"
    ? null
    : side._tag === "Text"
      ? snapshot(side.content)
      : unloadedSnapshot(side.blob);

const gitError = (operation: string) => (failure: GitCommandFailure) =>
  new GitError({
    reason: Match.value(failure.code).pipe(
      Match.when("ENOENT", () => "executable_missing" as const),
      Match.when("ERR_CHILD_PROCESS_STDIO_MAXBUFFER", () => "output_too_large" as const),
      Match.orElse(() => "command" as const),
    ),
    operation,
    detail: failure.detail,
    exitCode: failure.exitCode,
  });

export class Git extends Context.Service<
  Git,
  {
    detectDefaultBranch(): Effect.Effect<string, GitError>;
    /**
     * The branch HEAD tracks (`git branch --set-upstream-to`): a stacked branch's base. `undefined` when HEAD is
     * detached, tracks nothing or a ref that no longer exists, or tracks the same branch on a remote, whose merge base
     * would hide the commits already pushed.
     */
    trackedBase(): Effect.Effect<string | undefined>;
    /**
     * Where HEAD left `baseRef`, else the default branch: the baseline a change set compares against.
     */
    baseline(baseRef?: string): Effect.Effect<{ readonly ref: string; readonly commit: string }, GitError>;
    /**
     * Paths that exist in the working tree and differ from the merge base. Deleted paths are excluded.
     */
    changedFiles(baseRef?: string): Effect.Effect<ReadonlyArray<string>, GitError>;
    /**
     * The normalized comparison. `include` is applied to the changed paths before any content is read or diffed, so an
     * ignored or out-of-scope file costs nothing. Submodule entries are never part of a change set.
     */
    changeSet(input?: {
      readonly baseRef?: string;
      readonly include?: (path: string) => boolean;
    }): Effect.Effect<ChangeSet, GitError>;
    /**
     * Tracked and unignored untracked paths below the working directory. `undefined` when Git cannot list them: no Git,
     * no work tree, or a working directory the enclosing repository ignores.
     */
    readonly listFiles?: (() => Effect.Effect<ReadonlyArray<string> | undefined, GitError>) | undefined;
    /**
     * `HEAD` and the change baseline for `baseRef`, as commit ids. Equal answers mean the same commits are compared;
     * the working tree is not part of it. A baseline that cannot be resolved answers `unresolved`.
     */
    readonly revision?: ((baseRef?: string) => Effect.Effect<string, GitError>) | undefined;
  }
>()("agentlint/Git") {
  static readonly layer: Layer.Layer<Git, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    Git,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const runRaw = ({
        operation,
        args,
        literalPathspecs = true,
      }: {
        readonly operation: string;
        readonly args: ReadonlyArray<string>;
        readonly literalPathspecs?: boolean;
      }) =>
        runGitCommand({
          cwd: env.cwd,
          args,
          literalPathspecs,
          ...(env.variables ? { variables: env.variables } : {}),
        }).pipe(Effect.mapError(gitError(operation)));

      const run = ({
        operation,
        args,
        literalPathspecs = true,
      }: {
        readonly operation: string;
        readonly args: ReadonlyArray<string>;
        readonly literalPathspecs?: boolean;
      }) => runRaw({ operation, args, literalPathspecs }).pipe(Effect.map((value) => value.trim()));

      const memo: { repositoryPrefix: string | undefined } = { repositoryPrefix: undefined };
      const prefix = () =>
        memo.repositoryPrefix !== undefined
          ? Effect.succeed(memo.repositoryPrefix)
          : run({ operation: "repository prefix", args: ["rev-parse", "--show-prefix"] }).pipe(
              Effect.tap((value) => Effect.sync(() => (memo.repositoryPrefix = value))),
            );

      const existsRef = (ref: string) =>
        run({ operation: "reference lookup", args: ["rev-parse", "--verify", "--quiet", ref] }).pipe(
          Effect.as(true),
          Effect.catchIf(answersNo, () => Effect.succeed(false)),
        );

      const detectDefaultBranch = () =>
        run({
          operation: "default branch detection",
          args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        }).pipe(
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

      const trackedBase = Effect.fn("Git.trackedBase")(
        function* () {
          const branch = yield* run({ operation: "tracked branch lookup", args: ["symbolic-ref", "--quiet", "HEAD"] });
          const [upstream = "", upstreamBranch = ""] = (yield* run({
            operation: "tracked branch lookup",
            args: ["for-each-ref", "--format=%(upstream:short)%00%(upstream:remoteref)", branch],
          })).split("\0");
          if (upstream === "" || upstreamBranch === branch) return undefined;
          return (yield* existsRef(`${upstream}^{commit}`)) ? upstream : undefined;
        },
        // Without an answer the default branch decides; a Git failure that matters surfaces at the comparison itself.
        Effect.orElseSucceed(() => undefined),
      );

      const resolveBaseline = Effect.fn("Git.resolveBaseline")(function* (baseRef?: string) {
        const ref = yield* safeRef(baseRef ?? (yield* detectDefaultBranch()));
        const commit = yield* run({ operation: "merge-base", args: ["merge-base", "HEAD", ref] }).pipe(
          Effect.catchIf(
            (error) => error.reason === "command",
            (error) =>
              Effect.gen(function* () {
                const shallow = yield* run({
                  operation: "shallow clone detection",
                  args: ["rev-parse", "--is-shallow-repository"],
                });
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

      /**
       * The baseline blob of `filePath`, or `undefined` when the baseline has no such path.
       */
      const baselineBlob = ({
        commit,
        entry,
      }: {
        readonly commit: string;
        readonly entry: StatusEntry;
      }): Effect.Effect<string | undefined, GitError> => {
        if (entry.status === "added") return Effect.succeed(undefined);
        if (!NULL_BLOB.test(entry.beforeBlob)) return Effect.succeed(entry.beforeBlob);
        // Git leaves the blob unresolved for an unmerged path. Ask by name; the exit status answers, not the message.
        return prefix().pipe(
          Effect.flatMap((projectPrefix) =>
            run({
              operation: "baseline lookup",
              args: [
                "rev-parse",
                "--verify",
                "--quiet",
                `${commit}:${projectPrefix}${entry.previousPath ?? entry.path}`,
              ],
            }),
          ),
          Effect.map((blob): string | undefined => blob),
          Effect.catchIf(answersNo, () => Effect.succeed(undefined)),
        );
      };

      /**
       * The baseline side of every entry, read through one `cat-file --batch` process. An object too large to load
       * keeps its identity.
       */
      const readBaselines = Effect.fn("Git.readBaselines")(function* ({
        commit,
        entries,
      }: {
        readonly commit: string;
        readonly entries: ReadonlyArray<StatusEntry>;
      }) {
        const blobs = yield* Effect.forEach(entries, (entry) => baselineBlob({ commit, entry }), { concurrency: 4 });
        const ids = [...new Set(blobs.filter((blob) => blob !== undefined))];
        const objects = yield* readGitObjects({
          cwd: env.cwd,
          ids,
          ...(env.variables ? { variables: env.variables } : {}),
        }).pipe(Effect.mapError(gitError("file read")));
        const byId = new Map(ids.map((id, index) => [id, objects[index]]));
        return yield* Effect.forEach(blobs, (blob) => {
          if (blob === undefined) return Effect.succeed(undefined);
          const object = byId.get(blob);
          if (object === undefined)
            return Effect.fail(new GitError({ reason: "command", operation: "file read", detail: `${blob} missing` }));
          if (object._tag === "TooLarge") return Effect.succeed<SideContent>({ _tag: "Unloaded", blob });
          const content = object.bytes.toString("utf8");
          return Effect.succeed<SideContent>(
            isBinary(content) ? { _tag: "Unloaded", blob } : { _tag: "Text", content },
          );
        });
      });

      /**
       * Read the working side without following a link: a symbolic link is its target text, as Git stores it. A file
       * too large or too binary to load is `Unhashed` until `hashWorkingFiles` names its blob.
       */
      const readWorkingFile = Effect.fn("Git.readWorkingFile")(function* ({
        root,
        filePath,
      }: {
        readonly root: string;
        readonly filePath: string;
      }) {
        return yield* Effect.gen(function* () {
          const entry = yield* inspectRepositoryEntry({ fs, path, canonicalRoot: root, file: filePath });
          if (entry._tag !== "Missing" && entry.linkTarget !== undefined)
            return {
              _tag: "Text",
              content: toRepositoryPath({ value: entry.linkTarget, separator: path.sep }),
            } as const;
          if (entry._tag !== "Inside") return { _tag: "Skipped" } as const;
          const info = yield* fs.stat(entry.realPath);
          if (info.type !== "File") return { _tag: "Skipped" } as const;
          const content =
            Number(info.size) > GIT_MAX_BUFFER_BYTES ? undefined : yield* fs.readFileString(entry.realPath);
          if (content !== undefined && !isBinary(content)) return { _tag: "Text", content } as const;
          return { _tag: "Unhashed" } as const;
        }).pipe(
          Effect.mapError((error) =>
            error instanceof GitError
              ? error
              : new GitError({
                  reason: "command",
                  operation: "working file read",
                  detail: `${filePath}: ${String(error)}`,
                }),
          ),
        );
      });

      /**
       * Blob ids of working files, one `hash-object` process per command-line-sized run of paths.
       */
      const hashWorkingFiles = Effect.fn("Git.hashWorkingFiles")(function* (files: ReadonlyArray<string>) {
        const hashed = yield* Effect.forEach(
          pathChunks(files, (file) => file),
          (chunk) =>
            run({ operation: "file hash", args: ["hash-object", "--", ...chunk] }).pipe(
              Effect.map((output) => output.split("\n").map((line) => line.trim())),
            ),
          { concurrency: 4 },
        );
        const blobs = hashed.flat();
        return new Map(files.map((file, index) => [file, blobs[index] ?? ""]));
      });

      const diffArguments = ["diff", "--relative", "--no-ext-diff", "--no-textconv", "--unified=3"] as const;

      /**
       * The hunks of one entry from its own `git diff`, as every entry was diffed before batching. A rename needs both
       * of its paths in one comparison.
       */
      const diffOne = ({ commit, entry }: { readonly commit: string; readonly entry: StatusEntry }) =>
        runRaw({
          operation: "diff generation",
          args: [
            ...diffArguments,
            "--find-renames",
            commit,
            "--",
            entry.previousPath ?? entry.path,
            ...(entry.previousPath ? [entry.path] : []),
          ],
        }).pipe(
          Effect.catchIf(
            (error) => error.reason === "output_too_large",
            () => Effect.succeed(""),
          ),
          Effect.map((output) => [entry.path, parseUnifiedHunks(output)] as const),
        );

      /**
       * Hunks for many entries from one `git diff` per command-line-sized run of paths. Without rename detection and
       * with one path per entry, each file's patch is the one its own `git diff` prints. A run whose output exceeds the
       * cap is diffed file by file, so only a file too large to diff loses its hunks.
       */
      const diffMany = Effect.fn("Git.diffMany")(function* ({
        commit,
        entries,
      }: {
        readonly commit: string;
        readonly entries: ReadonlyArray<StatusEntry>;
      }) {
        const results = yield* Effect.forEach(
          pathChunks(entries, (entry) => entry.path),
          (chunk) =>
            runRaw({
              operation: "diff generation",
              args: [
                ...diffArguments,
                "--no-renames",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                commit,
                "--",
                ...chunk.map((entry) => entry.path),
              ],
            }).pipe(
              Effect.map((output) => {
                const patches = new Map<string, string[]>();
                for (const { path: file, patch } of splitPatches(output))
                  patches.set(file, [...(patches.get(file) ?? []), patch]);
                return chunk.map(
                  (entry) => [entry.path, parseUnifiedHunks((patches.get(entry.path) ?? []).join(""))] as const,
                );
              }),
              Effect.catchIf(
                (error) => error.reason === "output_too_large",
                () => Effect.forEach(chunk, (entry) => diffOne({ commit, entry }), { concurrency: 4 }),
              ),
            ),
          { concurrency: 4 },
        );
        return results.flat();
      });

      const collectStatus = Effect.fn("Git.collectStatus")(function* (baseCommit: string) {
        const tracked = parseGitRawStatus(
          yield* runRaw({
            operation: "changed file collection",
            args: ["diff", "--relative", "--raw", "--abbrev=40", "-z", "--find-renames", baseCommit, "--"],
          }),
          // A submodule is a commit pointer, not a file: it has no content to snapshot or scan.
        ).filter((entry) => entry.beforeMode !== GITLINK_MODE && entry.afterMode !== GITLINK_MODE);
        const trackedPaths = new Set(tracked.map((entry) => entry.path));
        const untracked = parseNulSeparated(
          yield* runRaw({
            operation: "untracked file collection",
            args: ["ls-files", "--others", "--exclude-standard", "-z"],
          }),
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
          ].toSorted((left, right) => compareStrings({ left: left.path, right: right.path })),
        };
      });

      const changeSet = Effect.fn("Git.changeSet")(function* ({
        baseRef,
        include,
      }: { readonly baseRef?: string; readonly include?: (path: string) => boolean } = {}) {
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
        const [baselines, working] = yield* Effect.all(
          [
            readBaselines({ commit: baseline.commit, entries: selected }),
            Effect.forEach(
              selected,
              (entry) =>
                entry.status === "deleted"
                  ? Effect.succeed(undefined)
                  : readWorkingFile({ root, filePath: entry.path }),
              { concurrency: 8 },
            ),
          ],
          { concurrency: 2 },
        );
        const hashes = yield* hashWorkingFiles(
          selected.filter((_, index) => working[index]?._tag === "Unhashed").map((entry) => entry.path),
        );
        const sides = selected.map((entry, index) => {
          const side = working[index];
          const after: SideContent | undefined =
            side?._tag === "Unhashed" ? { _tag: "Unloaded", blob: hashes.get(entry.path) ?? "" } : side;
          return { entry, before: baselines[index], after };
        });
        // An untracked file has no diff, and an unloaded side has none worth its size.
        const diffed = sides
          .filter(
            ({ entry, before, after }) =>
              after?._tag !== "Skipped" &&
              !untracked.has(entry.path) &&
              before?._tag !== "Unloaded" &&
              after?._tag !== "Unloaded",
          )
          .map(({ entry }) => entry);
        // A rename, and a path whose own diff also covers changes below it (a file replaced by a directory), keep their
        // own diff: a shared one could pair them differently.
        const trackedPaths = entries.filter((entry) => !untracked.has(entry.path)).map((entry) => entry.path);
        const ownDiff = (entry: StatusEntry) =>
          entry.previousPath !== undefined || trackedPaths.some((other) => other.startsWith(`${entry.path}/`));
        const [shared, own] = yield* Effect.all(
          [
            diffMany({ commit: baseline.commit, entries: diffed.filter((entry) => !ownDiff(entry)) }),
            Effect.forEach(diffed.filter(ownDiff), (entry) => diffOne({ commit: baseline.commit, entry }), {
              concurrency: 4,
            }),
          ],
          { concurrency: 2 },
        );
        const hunksByPath = new Map([...shared, ...own]);

        const files = sides.flatMap(({ entry, before, after }): ReadonlyArray<ChangedFile> => {
          if (after?._tag === "Skipped") return [];
          const parsedHunks = hunksByPath.get(entry.path) ?? [];
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
          return [
            {
              status: entry.status,
              path: entry.path,
              ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
              before: toSnapshot(before),
              after: toSnapshot(after),
              hunks: [...hunks],
            },
          ];
        });

        return {
          baseline: { kind: "git" as const, ref: baseline.ref, commit: baseline.commit },
          files,
        };
      });

      const changedFiles = Effect.fn("Git.changedFiles")(function* (baseRef?: string) {
        const baseline = yield* resolveBaseline(baseRef);
        const { entries } = yield* collectStatus(baseline.commit);
        return entries.filter((entry) => entry.status !== "deleted").map((entry) => entry.path);
      });

      const listFiles = () =>
        Effect.gen(function* () {
          const inside = yield* run({
            operation: "work tree detection",
            args: ["rev-parse", "--is-inside-work-tree"],
          }).pipe(
            Effect.catchIf(
              (error) => error.reason === "command" || error.reason === "executable_missing",
              () => Effect.succeed("false"),
            ),
          );
          if (inside !== "true") return undefined;
          // Below an ignored directory (a project inside a dotfiles repository) Git lists nothing at all.
          // `check-ignore` rejects literal pathspecs, and `.` has nothing to escape.
          const ignored = yield* run({
            operation: "ignore lookup",
            args: ["check-ignore", "--quiet", "."],
            literalPathspecs: false,
          }).pipe(
            Effect.as(true),
            Effect.catchIf(answersNo, () => Effect.succeed(false)),
          );
          if (ignored) return undefined;
          return parseNulSeparated(
            yield* runRaw({
              operation: "file listing",
              args: ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            }),
          );
        });

      const revision = Effect.fn("Git.revision")(function* (baseRef?: string) {
        const head = yield* run({
          operation: "revision lookup",
          args: ["rev-parse", "--verify", "--quiet", "HEAD"],
        }).pipe(Effect.catchIf(answersNo, () => Effect.succeed("unborn")));
        const baseline = yield* resolveBaseline(baseRef).pipe(
          Effect.map(({ ref, commit }) => `${ref} ${commit}`),
          Effect.catch(() => Effect.succeed("unresolved")),
        );
        return `${head} ${baseline}`;
      });

      return Git.of({
        detectDefaultBranch,
        trackedBase,
        baseline: resolveBaseline,
        changedFiles,
        changeSet,
        listFiles,
        revision,
      });
    }),
  );
}
