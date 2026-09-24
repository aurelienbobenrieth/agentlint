import { Array as A, Effect, FileSystem, Layer, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { featureTestLayer, featureTestRule } from "../../__fixtures__/feature-test-services.js";
import { AcceptanceImport, AcceptanceRevocation, type AcceptanceDecision } from "../../domain/acceptance.js";
import { Fingerprint } from "../../domain/fingerprint.js";
import type { FindingRecord } from "../../domain/finding.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";
import { acceptancesHandler } from "./handler.js";
import { AcceptancesCommand } from "./request.js";

const cwd = join(tmpdir(), "agentlint-v02-acceptances-test");
const agentRule = featureTestRule();
const humanRule = featureTestRule({ id: "security/risky", call: "risky", authority: "human" });
const TestLayer = featureTestLayer({ cwd, rules: [agentRule, humanRule] });
const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof TestLayer>>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const writeSource = Effect.fn("writeSource")(function* (source: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
  yield* fs.writeFileString(path.resolve(cwd, "src", "demo.ts"), source);
});
const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
});
const storedRecords = Effect.gen(function* () {
  return (yield* (yield* AcceptanceStore).read()).records;
});
const checkAll = checkHandler(new CheckCommand({ all: true, rules: [], base: undefined, files: [] }));

function decision({
  finding,
  authority,
  digest = finding.fingerprint.digest,
}: {
  readonly finding: FindingRecord;
  readonly authority: "agent" | "human";
  readonly digest?: string;
}) {
  return new AcceptanceImport({
    schemaVersion: 1,
    type: "accept",
    source: finding.source,
    fingerprint: new Fingerprint({
      scheme: finding.fingerprint.scheme,
      version: finding.fingerprint.version,
      digest,
    }),
    lineageKey: finding.lineageKey,
    reason: `Imported for ${finding.ruleId}.`,
    authority,
    actor: "human:reviewer",
    acceptedAt: "2026-08-20T10:00:00.000Z",
    reviewedSource: 'danger("x")\nrisky("y")\n',
  });
}

const importCommand = (imported: ReadonlyArray<AcceptanceDecision>) =>
  acceptancesHandler(new AcceptancesCommand({ action: "import", base: undefined, imported }));

beforeEach(async () => {
  await run(cleanup);
  await run(writeSource('danger("x")\nrisky("y")\n'));
});
afterEach(() => run(cleanup));

describe("acceptances import", () => {
  it("imports a detached revocation and rejects its replay", async () => {
    const finding = A.getUnsafe((await run(checkAll)).unresolved, 0);
    const accepted = decision({ finding, authority: "human" });
    await run(importCommand([accepted]));
    const revoked = new AcceptanceRevocation({
      schemaVersion: 1,
      type: "revoke",
      source: accepted.source,
      fingerprint: accepted.fingerprint,
      expectedAcceptedAt: accepted.acceptedAt,
      expectedReason: accepted.reason,
      reviewedSource: accepted.reviewedSource,
    });
    expect((await run(importCommand([revoked]))).exitCode).toBe(0);
    expect(await run(storedRecords)).toEqual([]);
    expect((await run(checkAll)).unresolved).toHaveLength(2);
    expect((await run(importCommand([revoked]))).rejectedCount).toBe(1);
  });

  it("imports every decision when all of them identify current findings with enough authority", async () => {
    const check = await run(checkAll);
    expect(check.unresolved).toHaveLength(2);
    const danger = A.getUnsafe(check.unresolved, 0);
    const risky = A.getUnsafe(check.unresolved, 1);

    const result = await run(
      importCommand([
        decision({ finding: danger, authority: "agent" }),
        decision({ finding: risky, authority: "human" }),
      ]),
    );
    expect(result.exitCode).toBe(0);
    expect(result.importedCount).toBe(2);
    expect(result.rejectedCount).toBe(0);
    expect(result.records).toHaveLength(2);
    expect(await run(storedRecords)).toHaveLength(2);

    const after = await run(checkAll);
    expect(after.exitCode).toBe(0);
    expect(after.accepted).toHaveLength(2);
  });

  it("rejects the whole import when one decision no longer matches a current finding", async () => {
    const check = await run(checkAll);
    const danger = A.getUnsafe(check.unresolved, 0);
    const risky = A.getUnsafe(check.unresolved, 1);

    const result = await run(
      importCommand([
        decision({ finding: danger, authority: "agent" }),
        decision({ finding: risky, authority: "human", digest: "0000000000000000stale" }),
      ]),
    );
    expect(result.exitCode).toBe(2);
    expect(result.importedCount).toBe(0);
    expect(result.rejectedCount).toBe(1);
    expect(result.records).toEqual([]);
    expect(await run(storedRecords)).toEqual([]);
  });

  it("rejects an agent decision for a finding that requires human authority", async () => {
    const check = await run(checkAll);
    const risky = check.unresolved.find((finding) => finding.ruleId === "security/risky");
    if (!risky) throw new Error("expected the human-authority finding");

    const result = await run(importCommand([decision({ finding: risky, authority: "agent" })]));
    expect(result.exitCode).toBe(2);
    expect(result.importedCount).toBe(0);
    expect(result.rejectedCount).toBe(1);
    expect(await run(storedRecords)).toEqual([]);
  });

  it("rejects a decision whose displayed source differs from the current evidence", async () => {
    const check = await run(checkAll);
    const danger = check.unresolved.find((finding) => finding.ruleId === "security/danger");
    if (!danger) throw new Error("expected the agent-authority finding");

    const original = decision({ finding: danger, authority: "human" });
    const tampered = new AcceptanceImport({
      schemaVersion: original.schemaVersion,
      type: original.type,
      source: original.source,
      fingerprint: original.fingerprint,
      lineageKey: original.lineageKey,
      reason: original.reason,
      authority: original.authority,
      actor: original.actor,
      acceptedAt: original.acceptedAt,
      reviewedSource: 'safe("x")\n',
    });
    const result = await run(importCommand([tampered]));
    expect(result).toMatchObject({ exitCode: 2, importedCount: 0, rejectedCount: 1 });
    expect(await run(storedRecords)).toEqual([]);
  });
});
