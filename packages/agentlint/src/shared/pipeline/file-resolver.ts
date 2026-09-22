/**
 * File resolution service.
 *
 * Determines which files to scan by applying the filter pipeline:
 *
 * 1. Candidate files (positional paths and globs, all files, or Git-changed files)
 * 2. Config ignores and the tool's own cache
 * 3. Files with an extension
 * 4. Regular files whose real path stays inside the repository and outside `.git`
 *
 * @module
 */

import { Cause, Effect, FileSystem, Path, Schema } from "effect";
import type { PlatformError } from "effect";
import { Env } from "../../config/env.js";
import picomatch from "picomatch";
import { compareStrings } from "../../domain/compare.js";
import { inspectRepositoryEntry, isInside, toRepositoryPath } from "../infrastructure/repository/entry/service.js";

export { inspectRepositoryEntry, isInside, toRepositoryPath } from "../infrastructure/repository/entry/service.js";

/**
 * Raised when candidate files cannot be enumerated.
 *
 * @since 0.1.0
 * @category Errors
 */
export class FileResolverError extends Schema.TaggedError<FileResolverError>()("agentlint/FileResolverError", {
  reason: Schema.Literal("filesystem"),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Cannot list files: ${this.detail}`;
  }
}

/**
 * Options controlling which files enter the lint pipeline.
 *
 * @since 0.1.0
 * @category Models
 */
export const ResolveOptions = Schema.Struct({
  /**
   * When `true`, scan all files instead of only git-changed files.
   */
  all: Schema.Boolean,
  /**
   * Git ref to diff against. Defaults to the detected default branch.
   */
  baseRef: Schema.optional(Schema.String),
  /**
   * Global ignore globs from the config file.
   */
  configIgnores: Schema.optional(Schema.Array(Schema.String)),
  /**
   * Explicit file paths passed as CLI positional arguments.
   */
  positionalFiles: Schema.optional(Schema.Array(Schema.String)),
});

/**
 * @since 0.1.0
 */
export type ResolveOptions = Schema.Schema.Type<typeof ResolveOptions>;

/**
 * Directories the walk never enters when Git cannot list the repository.
 */
const WALK_SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git"]);

/**
 * Agentlint's own disposable cache. `init` gitignores it; it stays out of every scan even without that entry.
 */
const OWN_CACHE_PREFIX = ".agentlint/.cache/";

const LIST_CONCURRENCY = 16;

const filesystemError = (error: PlatformError.PlatformError | Cause.UnknownError): FileResolverError =>
  new FileResolverError({ reason: "filesystem", detail: error.message });

function hasGlobSyntax(value: string): boolean {
  return /[*?[\]{}()!+@]/.test(value);
}

/**
 * Compile globs into one predicate. Dotfiles match like any other path, so `src/**` covers `src/.hidden/x.ts`. Every
 * glob agentlint evaluates goes through here.
 *
 * @since 0.2.0
 * @category Constructors
 */
export function compileGlobs(patterns: ReadonlyArray<string> | undefined): ((file: string) => boolean) | undefined {
  return patterns?.length ? picomatch([...patterns], { dot: true }) : undefined;
}

function toProjectPath({
  file,
  cwd,
  path,
}: {
  readonly file: string;
  readonly cwd: string;
  readonly path: Path.Path;
}): string {
  const resolved = path.resolve(cwd, file);
  if (!isInside({ path, root: cwd, candidate: resolved }))
    throw new FileResolverError({ reason: "filesystem", detail: `Path outside the repository: ${file}` });
  return toRepositoryPath({ value: path.relative(cwd, resolved), separator: path.sep });
}

/**
 * Match change-set paths against explicit CLI files with the same meaning the state resolver gives them: a glob is a
 * pattern, a literal is one repository path or a directory prefix. The comparison is lexical because a change can name
 * a deleted file. A typed argument may use either separator on every platform.
 *
 * @since 0.2.0
 * @category Constructors
 */
export function explicitPathMatcher({
  files,
  cwd,
  path,
}: {
  readonly files: ReadonlyArray<string>;
  readonly cwd: string;
  readonly path: Path.Path;
}): (projectPath: string) => boolean {
  const typed = files.map((file) => file.replace(/\\/g, "/"));
  const globMatcher = compileGlobs(typed.filter(hasGlobSyntax).map((file) => file.replace(/^\.\//, "")));
  const literals = typed.filter((file) => !hasGlobSyntax(file)).map((file) => toProjectPath({ file, cwd, path }));
  return (projectPath) =>
    globMatcher?.(projectPath) === true ||
    literals.some((literal) => literal === "" || projectPath === literal || projectPath.startsWith(`${literal}/`));
}

/**
 * Recursively list all files under `dir`, returning paths relative to `base`.
 *
 * The fallback for a directory Git cannot list. Skips only `node_modules` and `.git`. Any entry that cannot be
 * inspected (permission denied, dangling link) fails the listing, so an incomplete scan cannot authorize acceptance
 * cleanup.
 *
 * @since 0.1.0
 * @category Internals
 */
const listAllFiles: (input: {
  readonly dir: string;
  readonly base: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly ignored: (file: string) => boolean;
  readonly ancestors?: ReadonlySet<string>;
}) => Effect.Effect<string[], FileResolverError> = Effect.fn("listAllFiles")(function* ({
  dir,
  base,
  fs,
  path,
  ignored,
  ancestors = new Set(),
}: {
  readonly dir: string;
  readonly base: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly ignored: (file: string) => boolean;
  readonly ancestors?: ReadonlySet<string>;
}) {
  const canonical = yield* fs.realPath(dir).pipe(Effect.mapError(filesystemError));
  if (ancestors.has(canonical) || !isInside({ path, root: base, candidate: canonical })) {
    return yield* new FileResolverError({
      reason: "filesystem",
      detail: `Directory cycle or path outside the repository: ${dir}`,
    });
  }
  const nextAncestors = new Set(ancestors).add(canonical);
  const entries = yield* fs.readDirectory(dir).pipe(Effect.mapError(filesystemError));
  const listed = yield* Effect.forEach(
    entries.filter((name) => !WALK_SKIP_DIRS.has(name)),
    (name) => {
      const fullPath = path.resolve(dir, name);
      const projectPath = toRepositoryPath({ value: path.relative(base, fullPath), separator: path.sep });
      if (ignored(projectPath) || ignored(`${projectPath}/`)) return Effect.succeed<string[]>([]);
      return fs.stat(fullPath).pipe(
        Effect.mapError(filesystemError),
        Effect.flatMap((info) =>
          info.type === "Directory"
            ? listAllFiles({ dir: fullPath, base, fs, path, ignored, ancestors: nextAncestors })
            : Effect.succeed([projectPath]),
        ),
      );
    },
    { concurrency: LIST_CONCURRENCY },
  );
  return listed.flat();
});

/**
 * The Git queries the resolver needs. `listFiles` is optional so a caller without a repository listing, such as a test
 * double, falls back to the directory walk.
 *
 * @since 0.2.0
 * @category Models
 */
export interface ResolverGit<E> {
  changedFiles(baseRef?: string): Effect.Effect<ReadonlyArray<string>, E>;
  /**
   * Tracked and unignored untracked paths below the working directory, or `undefined` when Git cannot list them.
   */
  readonly listFiles?: (() => Effect.Effect<ReadonlyArray<string> | undefined, E>) | undefined;
}

/**
 * Determine the final set of files to lint.
 *
 * Applies the multi-layer filter pipeline described in the module header, then sorts the result by code unit for
 * deterministic output. Git failures pass through unwrapped.
 *
 * @since 0.1.0
 * @category Constructors
 */
export function resolveFiles<E>({
  options,
  gitService,
}: {
  readonly options: ResolveOptions;
  readonly gitService: ResolverGit<E>;
}): Effect.Effect<ReadonlyArray<string>, FileResolverError | E, FileSystem.FileSystem | Path.Path | Env> {
  return Effect.gen(function* () {
    const env = yield* Env;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.realPath(env.cwd).pipe(Effect.mapError(filesystemError));
    const ignoreMatcher = compileGlobs(options.configIgnores);
    const ignored = (file: string) => file.startsWith(OWN_CACHE_PREFIX) || ignoreMatcher?.(file) === true;
    /**
     * Every file of the repository: what Git tracks or would add, or the walk when Git cannot say.
     */
    const listRepository = Effect.gen(function* () {
      const listed = gitService.listFiles ? yield* gitService.listFiles() : undefined;
      return listed ?? (yield* listAllFiles({ dir: cwd, base: cwd, fs, path, ignored }));
    });
    const candidates: ReadonlyArray<string> = yield* Effect.gen(function* () {
      if (options.positionalFiles && options.positionalFiles.length > 0) {
        const literalFiles: string[] = [];
        const globPatterns: string[] = [];
        for (const file of options.positionalFiles) {
          if (hasGlobSyntax(file)) {
            globPatterns.push(file);
          } else {
            const target = yield* fs.realPath(path.resolve(cwd, file)).pipe(Effect.mapError(filesystemError));
            yield* Effect.try({
              try: () => toProjectPath({ file: target, cwd, path }),
              catch: (cause) =>
                new FileResolverError({ reason: "filesystem", detail: "Path leaves the repository", cause }),
            });
            const info = yield* fs.stat(target).pipe(Effect.mapError(filesystemError));
            if (info.type === "Directory")
              literalFiles.push(...(yield* listAllFiles({ dir: target, base: cwd, fs, path, ignored })));
            else literalFiles.push(toProjectPath({ file: target, cwd, path }));
          }
        }

        const globMatcher = compileGlobs(globPatterns);
        const globbed = globMatcher ? (yield* listRepository).filter((file) => globMatcher(file)) : [];
        if (globMatcher && globbed.length === 0)
          return yield* new FileResolverError({ reason: "filesystem", detail: "Explicit patterns matched no files" });
        return [...literalFiles, ...globbed];
      }
      return options.all ? yield* listRepository : yield* gitService.changedFiles(options.baseRef);
    });

    const unique = yield* Effect.try({
      try: () => [...new Set(candidates.map((file) => toProjectPath({ file, cwd, path })))],
      catch: (cause) => new FileResolverError({ reason: "filesystem", detail: "Path leaves the repository", cause }),
    });
    const selected = unique.filter((file) => !ignored(file) && path.extname(file).length > 0);
    // Git also lists deleted-but-indexed paths, gitlinks, and links that leave the repository: none of them is source.
    const present = yield* Effect.filter(
      selected,
      (file) =>
        inspectRepositoryEntry({ fs, path, canonicalRoot: cwd, file }).pipe(
          Effect.flatMap((entry) =>
            entry._tag === "Inside"
              ? Effect.map(fs.stat(entry.realPath), (info) => info.type === "File")
              : Effect.succeed(false),
          ),
          Effect.mapError(filesystemError),
        ),
      { concurrency: LIST_CONCURRENCY },
    );
    return present.toSorted((left, right) => compareStrings({ left, right }));
  });
}
