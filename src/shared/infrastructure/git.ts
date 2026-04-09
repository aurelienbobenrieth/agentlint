/**
 * Git integration — default branch detection and changed file collection.
 *
 * @module
 * @since 0.1.0
 */

import { Context, Effect, HashSet, Layer, Schema } from "effect";
import { Env } from "../../config/env.js";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/**
 * Raised when a git operation fails — e.g. not a git repo,
 * invalid ref, or `git` binary not found.
 *
 * @since 0.1.0
 * @category errors
 */
export class GitError extends Schema.TaggedErrorClass<GitError>()("GitError", {
  message: Schema.String,
}) {}

/**
 * Execute a git command and return trimmed stdout.
 *
 * Uses the array form of `ChildProcess.make` so that dynamic arguments
 * are properly tokenized.
 *
 * @since 0.1.0
 * @category internals
 */
const gitCmd = (args: string, cwd: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return (yield* spawner.string(ChildProcess.make("git", args.split(/\s+/), { cwd }))).trim();
  });

/**
 * Detect the default branch by checking whether `main` or `master` exists.
 * Falls back to `"main"` when neither can be verified.
 *
 * @since 0.1.0
 * @category internals
 */
const detectDefault = (cwd: string) =>
  gitCmd("rev-parse --verify main", cwd).pipe(
    Effect.map(() => "main" as string),
    Effect.catch(() =>
      gitCmd("rev-parse --verify master", cwd).pipe(
        Effect.map(() => "master" as string),
        Effect.catch(() => Effect.succeed("main" as string)),
      ),
    ),
  );

/**
 * Collect all files that differ from `baseRef`.
 *
 * Gathers the union of committed diffs, uncommitted changes, and
 * untracked files. Each source is caught so partial failures
 * (e.g. empty repo, no merge-base) are silently skipped.
 *
 * @since 0.1.0
 * @category internals
 */
const parseLines = (output: string): ReadonlyArray<string> =>
  output
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

const collectChangedFiles = (cwd: string, baseRef: string) =>
  Effect.all([
    // Committed changes since merge-base
    gitCmd(`merge-base HEAD ${baseRef}`, cwd).pipe(
      Effect.flatMap((mergeBase) => gitCmd(`diff --name-only ${mergeBase}...HEAD`, cwd)),
      Effect.catch(() => Effect.succeed("")),
    ),
    // Uncommitted changes
    gitCmd("diff --name-only HEAD", cwd).pipe(Effect.catch(() => Effect.succeed(""))),
    // Untracked files
    gitCmd("ls-files --others --exclude-standard", cwd).pipe(Effect.catch(() => Effect.succeed(""))),
  ]).pipe(
    Effect.map(([committed, uncommitted, untracked]) =>
      [
        ...HashSet.fromIterable([...parseLines(committed), ...parseLines(uncommitted), ...parseLines(untracked)]),
      ].toSorted(),
    ),
  );

/**
 * @example
 * ```ts
 * import { Console, Effect } from "effect"
 * import { Git } from "./infrastructure/git.js"
 *
 * const program = Effect.gen(function* () {
 *   const git = yield* Git
 *   const branch = yield* git.detectDefaultBranch()
 *   const changed = yield* git.changedFiles(branch)
 *   yield* Console.log(`${changed.length} files changed since ${branch}`)
 * })
 * ```
 *
 * @since 0.1.0
 */
export class Git extends Context.Service<
  Git,
  {
    /** Detect whether the default branch is `main` or `master`. */
    detectDefaultBranch(): Effect.Effect<string, GitError>;
    /** Return sorted list of files changed relative to `baseRef` (defaults to the detected default branch). */
    changedFiles(baseRef?: string): Effect.Effect<ReadonlyArray<string>, GitError>;
  }
>()("agentlint/Git") {
  static readonly layer: Layer.Layer<Git, never, ChildProcessSpawner.ChildProcessSpawner | Env> = Layer.effect(
    Git,
    Effect.gen(function* () {
      const env = yield* Env;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const provide = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
        Effect.provideService(effect, ChildProcessSpawner.ChildProcessSpawner, spawner);

      return Git.of({
        detectDefaultBranch: () =>
          provide(detectDefault(env.cwd)).pipe(Effect.mapError((e) => new GitError({ message: String(e) }))),

        changedFiles: (baseRef) =>
          (baseRef ? Effect.succeed(baseRef) : provide(detectDefault(env.cwd))).pipe(
            Effect.flatMap((base) => provide(collectChangedFiles(env.cwd, base))),
            Effect.mapError((e) => new GitError({ message: String(e) })),
          ),
      });
    }),
  );
}
