/**
 * File resolution service.
 *
 * Determines which files to scan by applying the filter pipeline:
 * 1. Candidate files (positional paths and globs, all files, or Git-changed files)
 * 2. Config ignores
 * 3. Files with an extension
 *
 * @module
 */

import { Effect, FileSystem, HashSet, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import picomatch from "picomatch";

/**
 * Raised when candidate files cannot be enumerated.
 *
 * @since 0.1.0
 * @category errors
 */
export class FileResolverError extends Schema.TaggedError<FileResolverError>()("agentlint/FileResolverError", {
  reason: Schema.Literals(["git", "filesystem"]),
  detail: Schema.String,
}) {
  override get message(): string {
    switch (this.reason) {
      case "git":
        return `Git error: ${this.detail}`;
      case "filesystem":
        return `Cannot list files: ${this.detail}`;
    }
  }
}

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
  /** Global ignore globs from the config file. */
  configIgnores: Schema.optional(Schema.Array(Schema.String)),
  /** Explicit file paths passed as CLI positional arguments. */
  positionalFiles: Schema.optional(Schema.Array(Schema.String)),
});

/** @since 0.1.0 */
export type ResolveOptions = Schema.Schema.Type<typeof ResolveOptions>;

const SKIP_DIRS: HashSet.HashSet<string> = HashSet.make(
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".cache",
  ".agents",
);

const LIST_CONCURRENCY = 16;

function hasGlobSyntax(value: string): boolean {
  return /[*?[\]{}()!+@]/.test(value);
}

function toProjectPath(file: string, cwd: string, path: Path.Path): string {
  const resolved = path.resolve(cwd, file);
  const relative = path.relative(cwd, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new FileResolverError({ reason: "filesystem", detail: `Path outside the repository: ${file}` });
  return relative.replace(/\\/g, "/");
}

/**
 * Recursively list all files under `dir`, returning paths relative to `base`.
 *
 * Skips `node_modules`, `.git`, and build output directories. Any entry that cannot be inspected (permission denied, dangling link) fails
 * the listing, so an incomplete scan cannot authorize acceptance cleanup.
 *
 * @since 0.1.0
 * @category internals
 */
function listAllFiles(
  dir: string,
  base: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
  ignored: (file: string) => boolean = () => false,
  ancestors: ReadonlySet<string> = new Set(),
): Effect.Effect<string[], FileResolverError> {
  return Effect.gen(function* () {
    const canonical = yield* fs
      .realPath(dir)
      .pipe(Effect.mapError((error) => new FileResolverError({ reason: "filesystem", detail: String(error) })));
    const relative = path.relative(base, canonical);
    if (
      ancestors.has(canonical) ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return yield* new FileResolverError({
        reason: "filesystem",
        detail: `Directory cycle or path outside the repository: ${dir}`,
      });
    }
    const nextAncestors = new Set(ancestors).add(canonical);
    const entries = yield* fs
      .readDirectory(dir)
      .pipe(Effect.mapError((error) => new FileResolverError({ reason: "filesystem", detail: String(error) })));
    const listed = yield* Effect.forEach(
      entries.filter(
        (name) =>
          !HashSet.has(SKIP_DIRS, name) && !ignored(path.relative(base, path.resolve(dir, name)).replace(/\\/g, "/")),
      ),
      (name) => {
        const fullPath = path.resolve(dir, name);
        return fs.stat(fullPath).pipe(
          Effect.mapError((error) => new FileResolverError({ reason: "filesystem", detail: String(error) })),
          Effect.flatMap((info) => {
            if (info.type === "Directory") {
              return listAllFiles(fullPath, base, fs, path, ignored, nextAncestors);
            }
            return fs.realPath(fullPath).pipe(
              Effect.mapError((error) => new FileResolverError({ reason: "filesystem", detail: String(error) })),
              Effect.flatMap((real) =>
                Effect.try({
                  try: () => {
                    toProjectPath(real, base, path);
                    return [path.relative(base, fullPath).replace(/\\/g, "/")];
                  },
                  catch: (error) => new FileResolverError({ reason: "filesystem", detail: String(error) }),
                }),
              ),
            );
          }),
        );
      },
      { concurrency: LIST_CONCURRENCY },
    );
    return listed.flat();
  });
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
    changedFiles(baseRef?: string): Effect.Effect<ReadonlyArray<string>, unknown>;
  },
): Effect.Effect<ReadonlyArray<string>, FileResolverError, FileSystem.FileSystem | Path.Path | Env> {
  return Effect.gen(function* () {
    const env = yield* Env;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs
      .realPath(env.cwd)
      .pipe(Effect.mapError((error) => new FileResolverError({ reason: "filesystem", detail: String(error) })));
    const ignoreMatcher = options.configIgnores?.length
      ? picomatch([...options.configIgnores], { dot: true })
      : undefined;
    let candidates: ReadonlyArray<string>;

    if (options.positionalFiles && options.positionalFiles.length > 0) {
      const literalFiles: string[] = [];
      const globPatterns: string[] = [];
      for (const file of options.positionalFiles) {
        if (hasGlobSyntax(file)) {
          globPatterns.push(file);
        } else {
          const target = yield* fs
            .realPath(path.resolve(cwd, file))
            .pipe(Effect.mapError((error) => new FileResolverError({ reason: "filesystem", detail: String(error) })));
          yield* Effect.try({
            try: () => toProjectPath(target, cwd, path),
            catch: (error) => new FileResolverError({ reason: "filesystem", detail: String(error) }),
          });
          const info = yield* fs
            .stat(target)
            .pipe(Effect.mapError((error) => new FileResolverError({ reason: "filesystem", detail: String(error) })));
          if (info.type === "Directory")
            literalFiles.push(...(yield* listAllFiles(target, cwd, fs, path, ignoreMatcher)));
          else literalFiles.push(toProjectPath(file, cwd, path));
        }
      }

      const globMatcher = globPatterns.length > 0 ? picomatch(globPatterns) : undefined;
      const globbed = globMatcher
        ? (yield* listAllFiles(cwd, cwd, fs, path, ignoreMatcher)).filter((file) => globMatcher(file))
        : [];
      if (globMatcher && globbed.length === 0)
        return yield* new FileResolverError({ reason: "filesystem", detail: "Explicit patterns matched no files" });
      candidates = [...literalFiles, ...globbed];
    } else if (options.all) {
      candidates = yield* listAllFiles(cwd, cwd, fs, path, ignoreMatcher);
    } else {
      candidates = yield* Effect.mapError(
        gitService.changedFiles(options.baseRef),
        (error) => new FileResolverError({ reason: "git", detail: String(error) }),
      );
    }

    const unique = new Set(candidates.map((file) => toProjectPath(file, cwd, path)));

    return [...unique]
      .filter((file) => !ignoreMatcher || !ignoreMatcher(file))
      .filter((file) => path.extname(file).length > 0)
      .toSorted();
  });
}
