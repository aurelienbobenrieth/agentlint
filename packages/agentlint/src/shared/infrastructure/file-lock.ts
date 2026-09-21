/**
 * Cross-process lock for the JSONL stores under `.agentlint`.
 *
 * @module
 * @since 0.2.0
 */

import { Clock, Effect, type FileSystem } from "effect";

const STALE_LOCK_MS = 30_000;
const ATTEMPTS = 100;
const RETRY_MS = 20;

/**
 * Run `operation` while holding an exclusive lock file.
 *
 * A transaction lasts milliseconds. A lock older than 30 seconds belongs to a process that stopped before releasing it,
 * so the next writer removes it. A more recent lock is never stolen: the wait is bounded and then fails with `fail`.
 */
export const withFileLock =
  <E>(fs: FileSystem.FileSystem, directory: string, lock: string, fail: (detail: unknown) => E) =>
  <A, E2, R>(operation: Effect.Effect<A, E2, R>): Effect.Effect<A, E | E2, R> => {
    const acquire = Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(fail));
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const now = yield* Clock.currentTimeMillis;
        const result = yield* fs.writeFileString(lock, `${now}\n`, { flag: "wx" }).pipe(Effect.result);
        if (result._tag === "Success") return;
        if (result.failure.reason._tag !== "AlreadyExists") return yield* Effect.fail(fail(result.failure));
        const lockedAt = Number((yield* fs.readFileString(lock).pipe(Effect.orElseSucceed(() => ""))).trim());
        if (lockedAt > 0 && now - lockedAt > STALE_LOCK_MS) {
          // The rename is atomic, so one waiter removes the abandoned lock and the others retry.
          const abandoned = `${lock}.${now}.stale`;
          yield* fs.rename(lock, abandoned).pipe(
            Effect.flatMap(() => fs.remove(abandoned)),
            Effect.ignore,
          );
          continue;
        }
        yield* Effect.sleep(RETRY_MS);
      }
      return yield* Effect.fail(
        fail(
          `The store is locked: ${lock}. A lock older than ${STALE_LOCK_MS / 1000} seconds is removed automatically. Retry then, or remove the file if its owning process stopped.`,
        ),
      );
    });
    return Effect.acquireUseRelease(
      acquire,
      () => operation,
      () => fs.remove(lock).pipe(Effect.orDie),
    );
  };
