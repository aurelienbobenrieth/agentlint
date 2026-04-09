/**
 * Local state store for tracking reviewed flags.
 *
 * Manages a `.agentlint-state` file in the project root that stores
 * hashes of flags that have been reviewed. This file is intended to
 * be **gitignored** — it is per-developer scratch state for tracking
 * progress during review sweeps.
 *
 * **Caveats**:
 * - Hashes encode file path, line, column, and message. Editing code
 *   above a reviewed flag shifts its position and invalidates the hash.
 *   This is by design — changed context should be re-reviewed.
 * - Stale hashes (from flags that no longer exist) accumulate harmlessly.
 *   Use `agentlint review --reset` to start fresh.
 *
 * @module
 * @since 0.1.0
 */

import { Context, Effect, FileSystem, HashSet, Layer, Path } from "effect";
import { Env } from "../../config/env.js";

/**
 * The filename used for local review state.
 *
 * @since 0.1.0
 * @category constants
 */
const STATE_FILENAME = ".agentlint-state";

/**
 * Parse the state file into a set of hashes.
 * Tolerates blank lines and `#`-prefixed comments.
 *
 * @since 0.1.0
 * @category internals
 */
function parseStateFile(content: string): HashSet.HashSet<string> {
  let hashes: HashSet.HashSet<string> = HashSet.empty();
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.length > 0 && !line.startsWith("#")) {
      hashes = HashSet.add(hashes, line);
    }
  }
  return hashes;
}

/**
 * Serialize a set of hashes into file content.
 *
 * @since 0.1.0
 * @category internals
 */
function serializeHashes(hashes: HashSet.HashSet<string>): string {
  return [...hashes].join("\n") + "\n";
}

/**
 * Effect service for loading and persisting reviewed-flag state.
 *
 * @since 0.1.0
 * @category services
 */
export class StateStore extends Context.Service<
  StateStore,
  {
    /** Load reviewed hashes from `.agentlint-state`. Returns an empty set if the file is missing. */
    load(): Effect.Effect<HashSet.HashSet<string>>;
    /** Append one or more hashes to `.agentlint-state`, deduplicating against existing entries. */
    append(hashes: ReadonlyArray<string>): Effect.Effect<void>;
    /** Delete the `.agentlint-state` file entirely. */
    reset(): Effect.Effect<void>;
  }
>()("agentlint/StateStore") {
  /**
   * Default layer — resolves the state file path from `Env.cwd`.
   *
   * @since 0.1.0
   * @category layers
   */
  static readonly layer: Layer.Layer<StateStore, never, FileSystem.FileSystem | Path.Path | Env> = Layer.unwrap(
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const statePath = path.resolve(env.cwd, STATE_FILENAME);

      return Layer.succeed(
        StateStore,
        StateStore.of({
          load: () =>
            fs.exists(statePath).pipe(
              Effect.orElseSucceed(() => false),
              Effect.flatMap((exists) =>
                exists
                  ? fs.readFileString(statePath).pipe(
                      Effect.map(parseStateFile),
                      Effect.orElseSucceed(() => HashSet.empty<string>()),
                    )
                  : Effect.succeed(HashSet.empty<string>()),
              ),
            ),

          append: (hashes) =>
            fs.exists(statePath).pipe(
              Effect.orElseSucceed(() => false),
              Effect.flatMap((exists) =>
                exists
                  ? fs.readFileString(statePath).pipe(
                      Effect.map(parseStateFile),
                      Effect.orElseSucceed(() => HashSet.empty<string>()),
                    )
                  : Effect.succeed(HashSet.empty<string>()),
              ),
              Effect.map((existing) => hashes.reduce((acc, h) => HashSet.add(acc, h), existing)),
              Effect.flatMap((merged) =>
                fs.writeFileString(statePath, serializeHashes(merged)).pipe(Effect.orElseSucceed(() => {})),
              ),
            ),

          reset: () =>
            fs.exists(statePath).pipe(
              Effect.orElseSucceed(() => false),
              Effect.flatMap((exists) =>
                exists ? fs.remove(statePath).pipe(Effect.orElseSucceed(() => {})) : Effect.void,
              ),
            ),
        }),
      );
    }),
  );
}
