/**
 * Ownership-safe cross-process lock for local JSONL stores.
 *
 * A lock is never stolen automatically. This fail-closed policy prevents a paused writer from deleting or writing
 * through a newer owner's lock. The error names the lock so a person can remove one left by a stopped process.
 *
 * @module
 * @since 0.2.0
 */

import { Effect, type FileSystem, type PlatformError } from "effect";
import { randomUUID } from "node:crypto";

const ATTEMPTS = 100;
const RETRY_MS = 20;

const ownerFrom = (content: string): string => content.split("\n", 1)[0] ?? "";

export const withFileLock =
  <E>({
    fs,
    directory,
    lock,
    fail,
  }: {
    readonly fs: FileSystem.FileSystem;
    readonly directory: string;
    readonly lock: string;
    readonly fail: (detail: PlatformError.PlatformError | string) => E;
  }) =>
  <A, E2, R>(operation: Effect.Effect<A, E2, R>): Effect.Effect<A, E | E2, R> => {
    const owner = randomUUID();
    const acquire = Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(fail));
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const result = yield* fs.writeFileString(lock, `${owner}\n`, { flag: "wx" }).pipe(Effect.result);
        if (result._tag === "Success") return owner;

        if (result.failure.reason._tag === "AlreadyExists") {
          yield* Effect.sleep(RETRY_MS);
          continue;
        }

        // Some Windows filesystems report exclusive-create contention as Unknown rather than AlreadyExists.
        // Existence usually distinguishes that shape from a genuine write failure. If the owner releases between the
        // failed create and this probe, one immediate exclusive-create retry succeeds; a repeated non-contention error
        // remains a real I/O failure instead of being hidden behind the bounded lock wait.
        const exists = yield* fs.exists(lock).pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          const probe = yield* fs.writeFileString(lock, `${owner}\n`, { flag: "wx" }).pipe(Effect.result);
          if (probe._tag === "Success") return owner;
          const contended =
            probe.failure.reason._tag === "AlreadyExists" ||
            (yield* fs.exists(lock).pipe(Effect.orElseSucceed(() => false)));
          if (!contended) return yield* Effect.fail(fail(probe.failure));
        }
        yield* Effect.sleep(RETRY_MS);
      }
      return yield* Effect.fail(
        fail(`The store is locked: ${lock}. If its owning process stopped, remove this file and retry.`),
      );
    });

    // A failed release is a typed store failure: the write may have landed, but the lock was not ours to remove.
    const release = (acquiredOwner: string) =>
      fs.readFileString(lock).pipe(
        Effect.mapError(fail),
        Effect.flatMap((content) =>
          ownerFrom(content) === acquiredOwner
            ? fs.remove(lock).pipe(Effect.mapError(fail))
            : Effect.fail(fail(`Lock ownership changed while the store was open: ${lock}`)),
        ),
      );

    return Effect.acquireUseRelease(acquire, () => operation, release);
  };
