/**
 * File resolution service.
 *
 * Determines which files to scan by applying the filter pipeline:
 * 1. Candidate files (from git diff or all files)
 * 2. Config files/ignores
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
  /** Global file globs from the config file. */
  configFiles: Schema.optional(Schema.Array(Schema.String)),
  /** Global ignore globs from the config file. */
  configIgnores: Schema.optional(Schema.Array(Schema.String)),
  /** Explicit file paths passed as CLI positional arguments. */
  positionalFiles: Schema.optional(Schema.Array(Schema.String)),
});

/** @since 0.1.0 */
export type ResolveOptions = Schema.Schema.Type<typeof ResolveOptions>;

const SKIP_DIRS: HashSet.HashSet<string> = HashSet.make("node_modules", ".git", "dist", ".cache");

function hasGlobSyntax(value: string): boolean {
  return /[*?[\]{}()!+@]/.test(value);
}

function toProjectPath(file: string, cwd: string, path: Path.Path): string {
  const resolved = path.resolve(cwd, file);
  const relative = path.relative(cwd, resolved);
  return relative.startsWith("..") ? file.replace(/\\/g, "/") : relative.replace(/\\/g, "/");
}

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
      const literalFiles: string[] = [];
      const globPatterns: string[] = [];
      for (const file of options.positionalFiles) {
        if (hasGlobSyntax(file)) {
          globPatterns.push(file);
        } else {
          literalFiles.push(toProjectPath(file, cwd, path));
        }
      }

      const globMatcher = globPatterns.length > 0 ? picomatch(globPatterns) : undefined;
      const globbed = globMatcher ? (yield* listAllFiles(cwd, cwd, fs, path)).filter((file) => globMatcher(file)) : [];
      candidates = [...literalFiles, ...globbed];
    } else if (options.all) {
      candidates = yield* listAllFiles(cwd, cwd, fs, path);
    } else {
      const changed = yield* Effect.mapError(
        gitService.changedFiles(options.baseRef),
        (e) => new FileResolverError({ message: `Git error: ${e}` }),
      );
      candidates = [...changed];
    }

    const filesMatcher = options.configFiles?.length ? picomatch(options.configFiles as string[]) : undefined;
    const ignoreMatcher = options.configIgnores?.length ? picomatch(options.configIgnores as string[]) : undefined;

    return candidates
      .map((f) => toProjectPath(f, cwd, path))
      .filter((f, index, files) => files.indexOf(f) === index)
      .filter((f) => !filesMatcher || filesMatcher(f))
      .filter((f) => !ignoreMatcher || !ignoreMatcher(f))
      .filter((f) => path.extname(f).length > 0)
      .toSorted();
  });
}
