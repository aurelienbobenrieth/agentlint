import { nextHandler } from "../next/handler.js";
import { NextCommand } from "../next/request.js";
import { Array as A, Effect, FileSystem, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { featureTestLayer, featureTestRule } from "../../__fixtures__/feature-test-services.js";
import { normalizeConfig } from "../../domain/config.js";
import { defineRule } from "../../domain/rule.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { applyReviewAction, buildReviewPayload, makeReviewSessionState } from "./handler.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";

const cwd = join(tmpdir(), "agentlint-v02-review-payload-test");
const source = 'export const result =\n  danger("x")\n';
const rule = featureTestRule();
const TestLayer = featureTestLayer({ cwd, rules: [rule] });

const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
}).pipe(Effect.provide(TestLayer));

afterEach(() => Effect.runPromise(cleanup));

describe("review payload", () => {
  it.effect("revokes accepted findings when changes are requested and reuses captured scan evidence", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, "src"), { recursive: true });
        yield* fs.writeFileString(join(cwd, "src", "demo.ts"), source);
        const session = makeReviewSessionState();
        const payload = yield* buildReviewPayload({ mode: "review", transport: "attached", session });
        const findingId = A.getUnsafe(payload.findings, 0).id;
        expect(
          yield* applyReviewAction(
            { type: "accept", findingId, reason: "Reviewed sandbox." },
            { mode: "review", session },
          ),
        ).toMatchObject({ ok: true });
        expect(
          yield* applyReviewAction({ type: "withdraw", findingId }, { mode: "calibration", session }),
        ).toMatchObject({ ok: false });
        expect((yield* (yield* AcceptanceStore).read()).records).toHaveLength(1);
        const calibrationSession = makeReviewSessionState();
        const calibrationBefore = yield* buildReviewPayload({
          mode: "calibration",
          transport: "attached",
          session: calibrationSession,
        });
        expect(calibrationBefore.findings.every((item) => item.status === "unresolved")).toBe(true);
        yield* applyReviewAction(
          { type: "calibrate", findingId, calibration: "applies", reason: null, note: "Useful trigger" },
          { mode: "calibration", session: calibrationSession },
        );
        const calibrationAfter = yield* buildReviewPayload({
          mode: "calibration",
          transport: "attached",
          session: calibrationSession,
        });
        expect(calibrationAfter.findings.find((item) => item.id === findingId)?.status).toBe("accepted");
        expect((yield* (yield* AcceptanceStore).read()).records).toHaveLength(1);
        expect(
          yield* applyReviewAction(
            { type: "request_changes", findingId, reason: "The sandbox is insufficient." },
            { mode: "review", session },
          ),
        ).toMatchObject({ ok: true });
        const result = yield* checkHandler(new CheckCommand({ all: true, rules: [], files: [], base: undefined }));
        expect(result.exitCode).toBe(1);
        yield* fs.writeFileString(join(cwd, "src", "demo.ts"), "safe()");
        const artifact = yield* buildReviewPayload({ mode: "review", transport: "detached", check: result });
        expect(artifact.sources["src/demo.ts"]).toBe(source);
        expect(artifact.findings).toHaveLength(1);
        expect(artifact.coverage.scope).toBe("complete");
      }).pipe(Effect.provide(TestLayer));
    }),
  );
  it.effect("revokes only the decision this session was shown", () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const store = yield* AcceptanceStore;
        const fs = yield* FileSystem.FileSystem;
        yield* cleanup;
        yield* fs.makeDirectory(join(cwd, "src"), { recursive: true });
        yield* fs.writeFileString(join(cwd, "src", "demo.ts"), source);
        const session = makeReviewSessionState();
        const options = { mode: "review" as const, session };
        const load = buildReviewPayload({ mode: "review", transport: "attached", session });
        const findingId = A.getUnsafe((yield* load).findings, 0).id;

        // Recorded elsewhere after this session rendered the finding as unresolved.
        const elsewhere = { mode: "review" as const, session: makeReviewSessionState() };
        yield* applyReviewAction({ type: "accept", findingId, reason: "Approved in another tab." }, elsewhere);
        for (const action of [
          { type: "withdraw", findingId } as const,
          { type: "request_changes", findingId, reason: "Rework this." } as const,
        ]) {
          expect(yield* applyReviewAction(action, options)).toMatchObject({
            ok: false,
            message: expect.stringContaining("Refresh the review"),
          });
        }
        expect((yield* store.read()).records.map((record) => record.reason)).toEqual(["Approved in another tab."]);
        expect(session.requested.size).toBe(0);
        expect(session.feedback).toEqual([]);

        // Shown, then replaced: the newer decision survives too.
        yield* load;
        yield* applyReviewAction({ type: "accept", findingId, reason: "Approved again." }, elsewhere);
        expect(yield* applyReviewAction({ type: "withdraw", findingId }, options)).toMatchObject({ ok: false });
        expect((yield* store.read()).records.map((record) => record.reason)).toEqual(["Approved again."]);

        yield* load;
        expect(yield* applyReviewAction({ type: "withdraw", findingId }, options)).toMatchObject({ ok: true });
        expect((yield* store.read()).records).toEqual([]);
        // A decision made here can be withdrawn without reloading, and withdrawing twice is harmless.
        yield* applyReviewAction({ type: "accept", findingId, reason: "Reviewed here." }, options);
        expect(yield* applyReviewAction({ type: "withdraw", findingId }, options)).toMatchObject({ ok: true });
        expect(yield* applyReviewAction({ type: "withdraw", findingId }, options)).toMatchObject({ ok: true });
        expect((yield* store.read()).records).toEqual([]);
        expect(
          yield* applyReviewAction(
            { type: "request_changes", findingId, reason: "" },
            { ...options, mode: "calibration" },
          ),
        ).toEqual({ ok: false, message: "Calibration cannot request changes." });
      }).pipe(Effect.provide(TestLayer));
    }),
  );

  it.effect("includes the complete source and the detector-selected focus range", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
        yield* fs.writeFileString(path.resolve(cwd, "src", "demo.ts"), source);
      }).pipe(Effect.provide(TestLayer));

      const payload = yield* buildReviewPayload({
        mode: "review",
        transport: "attached",
        applications: [{ id: "vscode", label: "VS Code" }],
      }).pipe(Effect.provide(TestLayer));

      expect(payload.findings).toHaveLength(1);
      expect(payload.sources["src/demo.ts"]).toBe(source);
      expect(payload.findings[0]?.code).toEqual({
        focus: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 14 },
      });
      expect(payload.findings[0]?.editor).toEqual({ canOpen: true });
      expect(payload.applications).toEqual([{ id: "vscode", label: "VS Code" }]);
      expect(payload.findings[0]?.guidance).toMatchObject({
        summary: null,
        standard: "Review danger calls.",
        checks: [],
        examples: [],
      });

      const detached = yield* buildReviewPayload({ mode: "review", transport: "detached", source: "review.json" }).pipe(
        Effect.provide(TestLayer),
      );
      expect(detached.findings[0]?.editor).toBeNull();
      expect(detached.applications).toEqual([]);
    }),
  );
});

describe("next handoff", () => {
  it.effect("resumes exact unresolved work and reopens changed evidence", () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const selectors = yield* SelectorCache;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, "src"), { recursive: true });
        yield* fs.writeFileString(join(cwd, "src", "demo.ts"), source);
        yield* selectors.write([
          {
            selector: "1",
            hash: "previous-finding",
            ruleId: "security/previous",
            file: "src/previous.ts",
            line: 1,
            column: 1,
          },
        ]);
        const command = new NextCommand({ base: "main", rules: [] });
        const first = yield* nextHandler(command);
        expect(first.status).toBe("unresolved");
        expect(first.scope).toBe("complete");
        expect(first.source).toBe(source);
        expect(first.finding?.guidance.standard).toBe("Review danger calls.");
        expect(first.actions[0]?.argv[0]).toBe("accept");
        expect((yield* nextHandler(command)).finding?.id).toBe(first.finding?.id);
        const finding = A.getUnsafe(first.finding === null ? [] : [first.finding], 0);
        yield* applyReviewAction(
          { type: "accept", findingId: finding.id, reason: "Verified sandbox" },
          { mode: "review", session: makeReviewSessionState() },
        );
        expect((yield* nextHandler(command)).status).toBe("clear");
        yield* fs.writeFileString(join(cwd, "src", "demo.ts"), source.replace('"x"', '"changed"'));
        const changed = yield* nextHandler(command);
        expect(changed.status).toBe("unresolved");
        expect(changed.finding?.id).not.toBe(finding.id);
        expect(changed.finding?.lineageReason).toContain("Verified sandbox");
        expect((yield* selectors.read()).findings).toMatchObject([{ hash: "previous-finding" }]);
      }).pipe(Effect.provide(TestLayer));
    }),
  );

  it.effect("offers a proposal and human review when agent acceptance cannot satisfy the binding", () =>
    Effect.gen(function* () {
      const humanRule = defineRule({ ...rule, binding: { ...rule.binding, authority: "human" } });
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, "src"), { recursive: true });
        yield* fs.writeFileString(join(cwd, "src", "demo.ts"), source);
        const result = yield* nextHandler(new NextCommand({ base: "main", rules: [rule.binding.id] }));
        expect(result.scope).toBe("partial");
        expect(result.finding?.authority).toBe("human");
        expect(result.actions.map((action) => action.argv[0])).toEqual(["propose", "review", "next", "check"]);
        expect(result.actions.every((action) => action.argv.includes("main"))).toBe(true);
      }).pipe(
        Effect.provideService(
          ConfigLoader,
          ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig({ rules: [humanRule] })) }),
        ),
        Effect.provide(TestLayer),
      );
    }),
  );
});

describe("calibration scope", () => {
  it.effect("keeps the displayed candidates, coverage and writable labels within the selected files", () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, "src"), { recursive: true });
        yield* fs.writeFileString(join(cwd, "src", "demo.ts"), source);
        yield* fs.writeFileString(join(cwd, "src", "outside.ts"), source);
        const session = makeReviewSessionState();
        const options = { mode: "calibration" as const, session, rules: [rule.binding.id], files: ["src/demo.ts"] };
        const full = yield* buildReviewPayload({ mode: "calibration", transport: "attached" });
        const selected = yield* buildReviewPayload({ ...options, transport: "attached" });
        expect(selected.findings.map((finding) => finding.file)).toEqual(["src/demo.ts"]);
        expect(selected.coverage).toMatchObject({ scope: "partial", rules: [rule.binding.id], files: ["src/demo.ts"] });
        const outside = A.getUnsafe(
          full.findings.filter((finding) => finding.file === "src/outside.ts"),
          0,
        );
        expect(
          yield* applyReviewAction(
            {
              type: "calibrate",
              findingId: outside.id,
              calibration: "applies",
              reason: null,
              note: "Outside the selection",
            },
            options,
          ),
        ).toMatchObject({ ok: false });
        expect(session.calibration).toEqual([]);
        expect((yield* (yield* AcceptanceStore).read()).records).toEqual([]);
      }).pipe(Effect.provide(TestLayer));
    }),
  );
});
