import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem } from "effect";
import { withFileLock } from "../shared/infrastructure/file/lock/live.ts";

const [directory, lock, holdText] = process.argv.slice(2);
const hold = Number(holdText);

if (!directory || !lock || !Number.isFinite(hold)) {
  throw new Error("Expected a directory, lock path, and hold duration.");
}

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* withFileLock({
    fs,
    directory,
    lock,
    fail: (detail) => new Error(String(detail)),
  })(
    Effect.gen(function* () {
      process.stdout.write("ACQUIRED\n");
      yield* Effect.sleep(hold);
    }),
  );
});

Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer))).then(
  () => process.stdout.write("RELEASED\n"),
  (error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 2;
  },
);
