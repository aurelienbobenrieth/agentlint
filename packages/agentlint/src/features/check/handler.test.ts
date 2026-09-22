import { Array as A, Effect, FileSystem, Layer, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { featureTestLayer, featureTestRule } from "../../__fixtures__/feature-test-services.js";
import { normalizeConfig } from "../../domain/config.js";
import { defineRule } from "../../domain/rule/model.js";
import { acceptFinding } from "../accept/handler.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git/service.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { normalizeChangeFixture } from "../../shared/pipeline/change-fixture.js";
import { checkHandler } from "./handler.js";
import { CheckCommand } from "./request.js";

const cwd = join(tmpdir(), "agentlint-v02-check-test");
const rule = featureTestRule();
const TestLayer = featureTestLayer({ cwd, rules: [rule] });
const command = new CheckCommand({ all: true, rules: [], base: undefined, files: [] });

const writeSource = Effect.fn("writeSource")(function* (source: string) {
  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
    yield* fs.writeFileString(path.resolve(cwd, "src", "demo.ts"), source);
  }).pipe(Effect.provide(TestLayer));
});
const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
}).pipe(Effect.provide(TestLayer));

afterEach(() => Effect.runPromise(cleanup));

describe("binary check and acceptance loop", () => {
  it.effect("scans dependent state files even when Git reports no source change", () =>
    Effect.gen(function* () {
      yield* writeSource('danger("x")');
      yield* Effect.flatMap(FileSystem.FileSystem, (fs) =>
        fs.writeFileString(join(cwd, "policy.txt"), "sandbox required"),
      ).pipe(Effect.provide(TestLayer));
      const config = Layer.succeed(
        ConfigLoader,
        ConfigLoader.of({
          load: () =>
            Effect.succeed(
              normalizeConfig({
                rules: [defineRule({ ...rule, binding: { ...rule.binding, dependencies: ["policy.txt"] } })],
              }),
            ),
        }),
      );
      const result = yield* checkHandler(
        new CheckCommand({ all: false, rules: command.rules, base: command.base, files: command.files }),
      ).pipe(Effect.provide(config), Effect.provide(TestLayer));
      expect(result.findings).toHaveLength(1);
      expect(result.scannedFiles).toEqual(["src/demo.ts"]);
      expect(result.scope).toBe("partial");
    }),
  );

  it.effect("does not replace the complete-scan selector cache from a partial scan", () =>
    Effect.gen(function* () {
      yield* writeSource('danger("x")');
      const cached = [
        {
          selector: "1",
          hash: "previous-finding",
          ruleId: "security/previous",
          file: "src/previous.ts",
          line: 1,
          column: 1,
        },
      ];
      const result = yield* Effect.gen(function* () {
        const selectors = yield* SelectorCache;
        yield* selectors.write(cached);
        const checked = yield* checkHandler(
          new CheckCommand({ all: command.all, rules: [rule.binding.id], base: command.base, files: command.files }),
        );
        return { checked, cache: yield* selectors.read() };
      }).pipe(Effect.provide(TestLayer));

      expect(result.checked.scope).toBe("partial");
      expect(result.checked.unresolved[0]?.selector).toMatch(/^[0-9a-f]{12}$/);
      expect(result.cache.findings).toEqual(cached);
    }),
  );

  it.effect("applies change rules to explicit files in every path form the state resolver accepts", () =>
    Effect.gen(function* () {
      const dropColumn = defineRule({
        lifecycle: "change",
        standard: { id: "database/safe-migration", revision: 1, title: "Migrations", guidance: "Review drops." },
        detector: {
          id: "sql/drop",
          version: 1,
          detect({ context }) {
            for (const changed of context.change.files)
              context.report({
                key: changed.path,
                file: changed.path,
                message: "Review this migration.",
                evidence: { statement: changed.after?.content ?? "" },
              });
          },
        },
        binding: { id: "database/safe-migration", authority: "human", include: ["migrations/**"] },
      });
      const layers = Layer.mergeAll(
        Layer.succeed(
          ConfigLoader,
          ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig({ rules: [dropColumn] })) }),
        ),
        Layer.succeed(
          Git,
          Git.of({
            detectDefaultBranch: () => Effect.succeed("main"),
            changedFiles: () => Effect.succeed(["migrations/1.sql"]),
            changeSet: () =>
              Effect.succeed(
                normalizeChangeFixture({ before: {}, after: { "migrations/1.sql": "DROP TABLE users;" } }),
              ),
          }),
        ),
      );
      const findingsFor = (files: ReadonlyArray<string>) =>
        checkHandler(new CheckCommand({ all: false, rules: command.rules, base: command.base, files })).pipe(
          Effect.provide(layers),
          Effect.provide(TestLayer),
          Effect.map((result) => result.findings.map((finding) => finding.file)),
        );

      const forms = ["migrations/1.sql", "./migrations/1.sql", "migrations\\1.sql", "migrations", "migrations/*.sql"];
      const reported = yield* Effect.forEach(forms, (form) => findingsFor([form]), { concurrency: "unbounded" });
      expect(Object.fromEntries(forms.map((form, index) => [form, reported[index]]))).toEqual(
        Object.fromEntries(forms.map((form) => [form, ["migrations/1.sql"]])),
      );
      expect(yield* findingsFor([join(cwd, "migrations", "1.sql")])).toEqual(["migrations/1.sql"]);
      expect(yield* findingsFor(["other"])).toEqual([]);
    }),
  );

  it.effect("does not load change snapshots for file-local state detectors", () =>
    Effect.gen(function* () {
      yield* writeSource('danger("x")');
      const git = Layer.succeed(
        Git,
        Git.of({
          detectDefaultBranch: () => Effect.succeed("main"),
          changedFiles: () => Effect.succeed(["src/demo.ts"]),
          changeSet: () => Effect.die("State-only scans must not load snapshots"),
        }),
      );
      const result = yield* checkHandler(
        new CheckCommand({ all: false, rules: command.rules, base: command.base, files: command.files }),
      ).pipe(Effect.provide(git), Effect.provide(TestLayer));
      expect(result.findings).toHaveLength(1);
    }),
  );

  it.effect("fails incomplete syntax without pruning existing decisions", () =>
    Effect.gen(function* () {
      yield* writeSource('danger("x")');
      const finding = A.getUnsafe((yield* checkHandler(command).pipe(Effect.provide(TestLayer))).findings, 0);
      yield* acceptFinding(finding, { authority: "agent", reason: "Reviewed." }).pipe(Effect.provide(TestLayer));
      yield* writeSource('danger("x"');
      const failure = yield* Effect.flip(checkHandler(command).pipe(Effect.provide(TestLayer)));
      expect(failure).toMatchObject({ reason: "parse_failed" });
      expect(yield* readStoredAcceptances).toHaveLength(1);
    }),
  );

  it.effect("keeps all separately accepted calls open", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* writeSource('danger("x"); danger("y"); danger("x");');
      const first = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      yield* Effect.forEach(
        first.findings,
        (finding) => acceptFinding(finding, { authority: "agent", reason: "Reviewed independently." }),
        { concurrency: 1 },
      ).pipe(Effect.provide(TestLayer));
      const result = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect(result.exitCode).toBe(0);
      expect(result.accepted).toHaveLength(3);
    }),
  );

  it.effect("fails missing paths without removing acceptance state", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* writeSource('danger("x")');
      const first = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      const finding = A.getUnsafe(first.findings, 0);
      yield* acceptFinding(finding, { authority: "agent", reason: "Reviewed." }).pipe(Effect.provide(TestLayer));
      const failure = yield* Effect.flip(
        checkHandler(
          new CheckCommand({ all: command.all, rules: command.rules, base: command.base, files: ["src/missing.ts"] }),
        ).pipe(Effect.provide(TestLayer)),
      );
      expect(failure).toMatchObject({ reason: "filesystem" });
      expect(yield* readStoredAcceptances).toHaveLength(1);
    }),
  );

  it.effect("rejects unknown bindings instead of silently running a subset", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        checkHandler(
          new CheckCommand({
            all: command.all,
            rules: [rule.binding.id, "missing"],
            base: command.base,
            files: command.files,
          }),
        ).pipe(Effect.provide(TestLayer)),
      );
      expect(failure).toMatchObject({ ruleId: "missing" });
    }),
  );
  it.effect("preserves formatting-only decisions and invalidates material evidence with transient lineage", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* writeSource('danger("x")\n');

      const first = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect(first.exitCode).toBe(1);
      expect(first.unresolved).toHaveLength(1);

      const finding = A.getUnsafe(first.unresolved, 0);
      yield* acceptFinding(finding, { authority: "agent", reason: "The sandbox owns this call." }).pipe(
        Effect.provide(TestLayer),
      );
      yield* writeSource('\n\n  danger( "x" )\n');
      const moved = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect(moved.exitCode).toBe(0);
      expect(moved.accepted).toHaveLength(1);

      yield* writeSource('danger("x", "new evidence")\n');
      const changed = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect(changed.exitCode).toBe(1);
      expect(changed.lineage).toMatchObject([{ reason: "The sandbox owns this call.", authority: "agent" }]);
      expect(changed.staleCount).toBe(1);
      expect(yield* readStoredAcceptances).toEqual([]);
    }),
  );

  it.effect("prunes stale acceptances only for a complete view", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* writeSource('danger("x")\n');
      const first = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      const finding = A.getUnsafe(first.unresolved, 0);
      yield* acceptFinding(finding, { authority: "agent", reason: "The sandbox owns this call." }).pipe(
        Effect.provide(TestLayer),
      );
      // New evidence: the stored acceptance no longer matches any current finding.
      yield* writeSource('danger("x", "new evidence")\n');

      const partialCommands = [
        new CheckCommand({ all: true, rules: ["security/danger"], base: undefined, files: [] }),
        new CheckCommand({ all: true, rules: [], base: undefined, files: ["src/demo.ts"] }),
        new CheckCommand({ all: false, rules: [], base: undefined, files: ["src/demo.ts"] }),
      ];
      const partialRuns = yield* Effect.forEach(
        partialCommands,
        (partial) =>
          Effect.all(
            {
              result: checkHandler(partial),
              stored: Effect.flatMap(AcceptanceStore, (store) => store.read()).pipe(
                Effect.map((snapshot) => snapshot.records),
              ),
            },
            { concurrency: "unbounded" },
          ),
        { concurrency: 1 },
      ).pipe(Effect.provide(TestLayer));
      for (const { result, stored } of partialRuns) {
        expect(result.scope).toBe("partial");
        expect(result.exitCode).toBe(1);
        expect(result.staleCount).toBe(0);
        expect(stored).toHaveLength(1);
      }

      const complete = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect(complete.scope).toBe("complete");
      expect(complete.staleCount).toBe(1);
      expect(yield* readStoredAcceptances).toEqual([]);
    }),
  );
});

const readStoredAcceptances = Effect.gen(function* () {
  return (yield* (yield* AcceptanceStore).read()).records;
}).pipe(Effect.provide(TestLayer));
