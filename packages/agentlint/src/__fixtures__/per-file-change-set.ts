/**
 * The per-file `Git.changeSet` of agentlint 0.4.0, kept as the reference the batched implementation must reproduce: one
 * `cat-file` and one `diff` process per changed file. Test-only; do not optimize.
 */

import { createHash } from "node:crypto";
import { Effect, FileSystem, Match, Path } from "effect";
import { compareStrings } from "../domain/compare.js";
import type { ChangeSet, ChangedFile, FileSnapshot } from "../domain/rule/model.js";
import { normalizeLineEndings, textLines } from "../domain/source-text.js";
import { inspectRepositoryEntry, toRepositoryPath } from "../shared/infrastructure/repository/entry/service.js";
import { GIT_MAX_BUFFER_BYTES, runGitCommand } from "../shared/infrastructure/git/command.js";
import { parseGitRawStatus, parseUnifiedHunks, type StatusEntry } from "../shared/infrastructure/git/parsing.js";
import { GitError } from "../shared/infrastructure/git/service.js";

const GITLINK_MODE = "160000";
const NULL_BLOB = /^0+$/;

type SideContent =
  | { readonly _tag: "Text"; readonly content: string }
  | { readonly _tag: "Unloaded"; readonly blob: string }
  | { readonly _tag: "Skipped" };

const digest = (content: string): string => createHash("sha256").update(content).digest("hex");
const snapshot = (content: string): FileSnapshot => {
  const normalized = normalizeLineEndings(content);
  return { content: normalized, digest: digest(normalized) };
};
const isBinary = (content: string): boolean => content.slice(0, 8000).includes("\0");
const answersNo = (error: GitError): boolean => error.reason === "command" && error.exitCode === 1;
const toSnapshot = (side: SideContent | undefined): FileSnapshot | null =>
  side === undefined || side._tag === "Skipped"
    ? null
    : side._tag === "Text"
      ? snapshot(side.content)
      : { digest: `git-blob:${side.blob}` };

export const perFileChangeSet = Effect.fn("perFileChangeSet")(function* ({
  cwd,
  baseRef,
  include,
}: {
  readonly cwd: string;
  readonly baseRef: string;
  readonly include?: (path: string) => boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runRaw = ({ operation, args }: { readonly operation: string; readonly args: ReadonlyArray<string> }) =>
    runGitCommand({ cwd, args, literalPathspecs: true }).pipe(
      Effect.mapError(
        (failure) =>
          new GitError({
            reason: Match.value(failure.code).pipe(
              Match.when("ENOENT", () => "executable_missing" as const),
              Match.when("ERR_CHILD_PROCESS_STDIO_MAXBUFFER", () => "output_too_large" as const),
              Match.orElse(() => "command" as const),
            ),
            operation,
            detail: failure.detail,
            exitCode: failure.exitCode,
          }),
      ),
    );
  const run = (input: { readonly operation: string; readonly args: ReadonlyArray<string> }) =>
    runRaw(input).pipe(Effect.map((value) => value.trim()));

  const commit = yield* run({ operation: "merge-base", args: ["merge-base", "HEAD", baseRef] });
  const projectPrefix = yield* run({ operation: "repository prefix", args: ["rev-parse", "--show-prefix"] });
  const root = yield* fs.realPath(cwd);

  const tracked = parseGitRawStatus(
    yield* runRaw({
      operation: "changed file collection",
      args: ["diff", "--relative", "--raw", "--abbrev=40", "-z", "--find-renames", commit, "--"],
    }),
  ).filter((entry) => entry.beforeMode !== GITLINK_MODE && entry.afterMode !== GITLINK_MODE);
  const trackedPaths = new Set(tracked.map((entry) => entry.path));
  const untrackedList = (yield* runRaw({
    operation: "untracked file collection",
    args: ["ls-files", "--others", "--exclude-standard", "-z"],
  }))
    .split("\0")
    .filter((entry) => entry.length > 0);
  const untracked = new Set(untrackedList);
  const entries = [
    ...tracked,
    ...untrackedList
      .filter((file) => !trackedPaths.has(file) && !file.endsWith("/"))
      .map((file): StatusEntry => ({
        status: "added",
        path: file,
        beforeMode: "000000",
        afterMode: "100644",
        beforeBlob: "0",
      })),
  ].toSorted((left, right) => compareStrings({ left: left.path, right: right.path }));

  const readBaseline = (entry: StatusEntry) =>
    Effect.gen(function* () {
      if (entry.status === "added") return undefined;
      const blob = !NULL_BLOB.test(entry.beforeBlob)
        ? entry.beforeBlob
        : yield* run({
            operation: "baseline lookup",
            args: ["rev-parse", "--verify", "--quiet", `${commit}:${projectPrefix}${entry.previousPath ?? entry.path}`],
          }).pipe(
            Effect.map((value): string | undefined => value),
            Effect.catchIf(answersNo, () => Effect.succeed(undefined)),
          );
      if (blob === undefined) return undefined;
      return yield* runRaw({ operation: "file read", args: ["cat-file", "blob", blob] }).pipe(
        Effect.map((content): SideContent =>
          isBinary(content) ? { _tag: "Unloaded", blob } : { _tag: "Text", content },
        ),
        Effect.catchIf(
          (error) => error.reason === "output_too_large",
          () => Effect.succeed<SideContent>({ _tag: "Unloaded", blob }),
        ),
      );
    });

  const readWorkingFile = (filePath: string) =>
    Effect.gen(function* () {
      const entry = yield* inspectRepositoryEntry({ fs, path, canonicalRoot: root, file: filePath });
      if (entry._tag !== "Missing" && entry.linkTarget !== undefined)
        return { _tag: "Text", content: toRepositoryPath({ value: entry.linkTarget, separator: path.sep }) } as const;
      if (entry._tag !== "Inside") return { _tag: "Skipped" } as const;
      const info = yield* fs.stat(entry.realPath);
      if (info.type !== "File") return { _tag: "Skipped" } as const;
      const content = Number(info.size) > GIT_MAX_BUFFER_BYTES ? undefined : yield* fs.readFileString(entry.realPath);
      if (content !== undefined && !isBinary(content)) return { _tag: "Text", content } as const;
      return {
        _tag: "Unloaded",
        blob: yield* run({ operation: "file hash", args: ["hash-object", "--", filePath] }),
      } as const;
    });

  const selected = include
    ? entries.filter(
        (entry) => include(entry.path) || (entry.previousPath !== undefined && include(entry.previousPath)),
      )
    : entries;
  const files = yield* Effect.forEach(
    selected,
    (entry) =>
      Effect.gen(function* () {
        const before = yield* readBaseline(entry);
        const after: SideContent | undefined =
          entry.status === "deleted" ? undefined : yield* readWorkingFile(entry.path);
        if (after?._tag === "Skipped") return undefined;
        const loaded = before?._tag !== "Unloaded" && after?._tag !== "Unloaded";
        const parsedHunks =
          untracked.has(entry.path) || !loaded
            ? []
            : parseUnifiedHunks(
                yield* runRaw({
                  operation: "diff generation",
                  args: [
                    "diff",
                    "--relative",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--unified=3",
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
    baseline: { kind: "git" as const, ref: baseRef, commit },
    files: files.filter((file) => file !== undefined),
  } satisfies ChangeSet;
});
