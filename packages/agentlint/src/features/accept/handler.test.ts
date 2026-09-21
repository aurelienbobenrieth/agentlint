import { Effect, FileSystem, Layer, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { featureTestLayer, featureTestRule } from "../../__fixtures__/feature-test-services.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";
import { acceptHandler } from "./handler.js";
import { AcceptCommand } from "./request.js";

const cwd = join(tmpdir(), "agentlint-v02-accept-test");
const humanRule = featureTestRule({ authority: "human" });
const layerFor = (actor: string) => featureTestLayer({ cwd, rules: [humanRule], actor });
const run = <A, E>({
  effect,
  actor = "agent:test",
}: {
  readonly effect: Effect.Effect<A, E, Layer.Success<ReturnType<typeof layerFor>>>;
  readonly actor?: string;
}) => Effect.runPromise(effect.pipe(Effect.provide(layerFor(actor))));

const writeSource = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
  yield* fs.writeFileString(path.resolve(cwd, "src", "demo.ts"), 'danger("x")');
});
const check = checkHandler(new CheckCommand({ all: true, rules: [], base: undefined, files: [] }));
const accept = ({
  authority,
  reason,
  selector,
}: {
  readonly authority: "agent" | "human";
  readonly reason: string | undefined;
  readonly selector?: string;
}) => acceptHandler(new AcceptCommand({ selector, reason, authority, base: undefined }));
const storedAuthorities = Effect.map(
  Effect.flatMap(AcceptanceStore, (store) => store.read()),
  ({ records }) => records.map((record) => record.authority),
);

afterEach(() =>
  run({
    effect: Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  }),
);

describe("accept and approve", () => {
  it("refuses agent authority on a human binding and records nothing", async () => {
    await run({ effect: writeSource });
    expect((await run({ effect: check })).exitCode).toBe(1);

    const refused = await run({
      effect: accept({ authority: "agent", reason: "The call is sandboxed.", selector: "1" }),
    });
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toContain("requires human acceptance");
    expect(await run({ effect: storedAuthorities })).toEqual([]);
    expect((await run({ effect: check })).exitCode).toBe(1);
  });

  it("opens the gate when a human approves the same finding", async () => {
    await run({ effect: writeSource });
    await run({ effect: check });

    const approved = await run({
      effect: accept({ authority: "human", reason: "  Reviewed the sandbox boundary.  ", selector: "1" }),
      actor: "human:reviewer",
    });
    expect(approved.exitCode).toBe(0);
    expect(approved.message).toBe("Accepted security/danger at src/demo.ts:1.");
    const { records } = await run({ effect: Effect.flatMap(AcceptanceStore, (store) => store.read()) });
    expect(records.map(({ authority, reason, actor }) => ({ authority, reason, actor }))).toEqual([
      { authority: "human", reason: "Reviewed the sandbox boundary.", actor: "human:reviewer" },
    ]);
    expect((await run({ effect: check })).exitCode).toBe(0);
  });

  it("refuses to mint human authority from an agent process", async () => {
    await run({ effect: writeSource });
    await run({ effect: check });

    const refused = await run({ effect: accept({ authority: "human", reason: "Reviewed.", selector: "1" }) });
    expect(refused).toMatchObject({ exitCode: 2, message: expect.stringContaining("human actor") });
    expect(await run({ effect: storedAuthorities })).toEqual([]);
  });

  it("rejects a missing selector, a blank reason, and an unknown selector without writing", async () => {
    await run({ effect: writeSource });
    await run({ effect: check });

    expect(await run({ effect: accept({ authority: "human", reason: "Reviewed." }) })).toMatchObject({ exitCode: 2 });
    expect(await run({ effect: accept({ authority: "human", reason: "   ", selector: "1" }) })).toMatchObject({
      exitCode: 2,
      message: expect.stringContaining("reason"),
    });
    expect(await run({ effect: accept({ authority: "human", reason: "Reviewed.", selector: "99" }) })).toMatchObject({
      exitCode: 2,
    });
    expect(await run({ effect: storedAuthorities })).toEqual([]);
  });
});
