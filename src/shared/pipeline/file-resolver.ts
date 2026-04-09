/**
 * File resolution service.
 *
 * Determines which files to lint by applying the filter pipeline:
 * 1. Candidate files (from git diff or all files)
 * 2. Config include/ignore
 *
 * Per-rule filtering (languages, include, ignore) is done by the check command.
 *
 * @module
 */

import { Effect, FileSystem, HashSet, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import picomatch from "picomatch";

/**
 * Raised when file resolution fails — e.g. a git error bubbling up
 * from the changed-files query.
 *
 * @since 0.1.0
 * @category errors
 */
export class FileResolverError extends Schema.TaggedErrorClass<FileResolverError>()("FileResolverError", {
  message: Schema.String,
}) {}

/**
 * Options controlling which files enter the lint pipeline.
 *
 * @since 0.1.0
 * @category models
 */
export const ResolveOptions = Schema.Struct({
  /** When `true`, scan all files instead of only git-changed files. */
  all: Schema.Boolean,
  /** Git ref to diff against. Defaults to the detected default branch. */
  baseRef: Schema.optional(Schema.String),
  /** Global include globs from the config file. */
  configInclude: Schema.optional(Schema.Array(Schema.String)),
  /** Global ignore globs from the config file. */
  configIgnore: Schema.optional(Schema.Array(Schema.String)),
  /** Explicit file paths passed as CLI positional arguments. */
  positionalFiles: Schema.optional(Schema.Array(Schema.String)),
});

/** @since 0.1.0 */
export type ResolveOptions = Schema.Schema.Type<typeof ResolveOptions>;

/** Directories that are always skipped during recursive listing. */
const SKIP_DIRS: HashSet.HashSet<string> = HashSet.make("node_modules", ".git", "dist");

/**
 * Recursively list all files under `dir`, returning paths relative to `base`.
 *
 * Skips `node_modules`, `.git`, and `dist` directories. Errors (e.g.
 * permission denied) are silently swallowed.
 *
 * Uses the Effect `FileSystem` and `Path` services for cross-platform
 * file system access.
 *
 * @since 0.1.0
 * @category internals
 */
function listAllFiles(dir: string, base: string, fs: FileSystem.FileSystem, path: Path.Path): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const entries = yield* fs.readDirectory(dir);
    const results: string[] = [];

    for (const name of entries) {
      if (HashSet.has(SKIP_DIRS, name)) continue;

      const fullPath = path.resolve(dir, name);
      const info = yield* fs.stat(fullPath);
      const relPath = path.relative(base, fullPath).replace(/\\/g, "/");

      if (info.type === "Directory") {
        results.push(...(yield* listAllFiles(fullPath, base, fs, path)));
      } else {
        results.push(relPath);
      }
    }

    return results;
  }).pipe(Effect.catch(() => Effect.succeed([] as string[])));
}

/**
 * Determine the final set of files to lint.
 *
 * Applies the multi-layer filter pipeline described in the module header,
 * then sorts the result alphabetically for deterministic output.
 *
 * @since 0.1.0
 * @category constructors
 */
export function resolveFiles(
  options: ResolveOptions,
  gitService: {
    changedFiles(baseRef?: string): Effect.Effect<ReadonlyArray<string>, any>;
  },
): Effect.Effect<ReadonlyArray<string>, FileResolverError, FileSystem.FileSystem | Path.Path | Env> {
  return Effect.gen(function* () {
    const env = yield* Env;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { cwd } = env;
    let candidates: string[];

    if (options.positionalFiles && options.positionalFiles.length > 0) {
      candidates = [...options.positionalFiles];
    } else if (options.all) {
      candidates = yield* listAllFiles(cwd, cwd, fs, path);
    } else {
      const changed = yield* Effect.mapError(
        gitService.changedFiles(options.baseRef),
        (e) => new FileResolverError({ message: `Git error: ${e}` }),
      );
      candidates = [...changed];
    }

    const includeMatcher = options.configInclude?.length ? picomatch(options.configInclude as string[]) : undefined;
    const ignoreMatcher = options.configIgnore?.length ? picomatch(options.configIgnore as string[]) : undefined;

    return candidates
      .filter((f) => !includeMatcher || includeMatcher(f))
      .filter((f) => !ignoreMatcher || !ignoreMatcher(f))
      .filter((f) => path.extname(f).length > 0)
      .toSorted();
  });
}
