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
  return relative.startsWith("..") ? file.replace(/\\/g, "/") : relative.replace(/\\/g, "/");
}

/**
 * Recursively list all files under `dir`, returning paths relative to `base`.
 *
 * Skips `node_modules`, `.git`, and build output directories. An entry that
 * cannot be inspected (permission denied, dangling link) is dropped on its
 * own; its siblings are still listed. Failing to read `dir` itself fails the
 * listing.
 *
 * @since 0.1.0
 * @category internals
 */
function listAllFiles(
  dir: string,
  base: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): Effect.Effect<string[], FileResolverError> {
  return Effect.gen(function* () {
    const entries = yield* fs
      .readDirectory(dir)
      .pipe(Effect.mapError((error) => new FileResolverError({ reason: "filesystem", detail: String(error) })));
    const listed = yield* Effect.forEach(
      entries.filter((name) => !HashSet.has(SKIP_DIRS, name)),
      (name) => {
        const fullPath = path.resolve(dir, name);
        return fs.stat(fullPath).pipe(
          Effect.option,
          Effect.flatMap((info) => {
            if (info._tag === "None") return Effect.succeed([] as string[]);
            if (info.value.type === "Directory") {
              return listAllFiles(fullPath, base, fs, path).pipe(Effect.orElseSucceed(() => [] as string[]));
            }
            return Effect.succeed([path.relative(base, fullPath).replace(/\\/g, "/")]);
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
    const { cwd } = env;
    let candidates: ReadonlyArray<string>;

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
      candidates = yield* Effect.mapError(
        gitService.changedFiles(options.baseRef),
        (error) => new FileResolverError({ reason: "git", detail: String(error) }),
      );
    }

    const ignoreMatcher = options.configIgnores?.length ? picomatch([...options.configIgnores]) : undefined;
    const unique = new Set(candidates.map((file) => toProjectPath(file, cwd, path)));

    return [...unique]
      .filter((file) => !ignoreMatcher || !ignoreMatcher(file))
      .filter((file) => path.extname(file).length > 0)
      .toSorted();
  });
}
