import { Effect, FileSystem, Layer, Path } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { featureTestLayer, featureTestRule } from "../../__fixtures__/feature-test-services.js";
import { OutcomeStore } from "../../shared/infrastructure/outcome-store.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";
import { listOutcomesHandler, recordOutcomeHandler } from "./handler.js";
import { RecordOutcomeCommand } from "./request.js";

const cwd = join(tmpdir(), `agentlint-v02-outcomes-${randomUUID()}`);
const TestLayer = featureTestLayer({ cwd, rules: [featureTestRule()] });
const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof TestLayer>>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const writeSource = Effect.fn("writeSource")(function* (source: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
  yield* fs.writeFileString(path.resolve(cwd, "src/demo.ts"), source);
});
const record = (kind: "incident" | "rollback", reference: string, note: string) =>
  recordOutcomeHandler(new RecordOutcomeCommand({ selector: "1", kind, reference, note, base: undefined }));

afterEach(() =>
  run(
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  ),
);

describe("outcomes", () => {
  it("records delayed evidence without changing the gate", async () => {
    await run(writeSource('danger("x")'));
    const check = new CheckCommand({ all: true, rules: [], base: undefined, files: [] });
    await run(checkHandler(check));
    const result = await run(
      recordOutcomeHandler(
        new RecordOutcomeCommand({
          selector: "1",
          kind: "corrective_change",
          reference: "commit:abc123",
          note: "A second owner drifted from the policy.",
          base: undefined,
        }),
      ),
    );
    expect(result).toMatchObject({ exitCode: 0, message: expect.stringContaining("corrective_change") });
    expect((await run(listOutcomesHandler())).records).toMatchObject([
      {
        kind: "corrective_change",
        reference: "commit:abc123",
        note: "A second owner drifted from the policy.",
        actor: "agent:test",
      },
    ]);
    expect((await run(checkHandler(check))).exitCode).toBe(1);
  });

  it("keeps distinct outcomes and replaces the same kind and reference", async () => {
    await run(writeSource('danger("x")'));
    await run(checkHandler(new CheckCommand({ all: true, rules: [], base: undefined, files: [] })));
    await run(record("incident", "INC-1", "First note."));
    await run(record("rollback", "commit:def", "Rolled back."));
    await run(record("incident", "INC-1", "Updated note."));
    const records = (await run(listOutcomesHandler())).records;
    expect(records).toHaveLength(2);
    expect(records.find(({ reference }) => reference === "INC-1")?.note).toBe("Updated note.");
  });

  it("rejects incomplete input and reports malformed storage", async () => {
    await run(writeSource('danger("x")'));
    await run(checkHandler(new CheckCommand({ all: true, rules: [], base: undefined, files: [] })));
    expect(
      await run(
        recordOutcomeHandler(
          new RecordOutcomeCommand({
            selector: "1",
            kind: "incident",
            reference: " ",
            note: "Missing reference.",
            base: undefined,
          }),
        ),
      ),
    ).toMatchObject({ exitCode: 2 });

    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, ".agentlint"), { recursive: true });
        yield* fs.writeFileString(join(cwd, ".agentlint", "outcomes.jsonl"), '{"schemaVersion":1}\n');
      }),
    );
    const error = await run(Effect.flip(Effect.flatMap(OutcomeStore, (store) => store.read())));
    expect(error).toMatchObject({ reason: "invalid_record", line: 1 });
  });
});
