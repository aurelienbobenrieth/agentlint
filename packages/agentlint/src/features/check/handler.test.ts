import { Array as A, Effect, FileSystem, Layer, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { featureTestLayer, featureTestRule } from "../../__fixtures__/feature-test-services.js";
import { normalizeConfig } from "../../domain/config.js";
import { defineRule, type AgentlintRule } from "../../domain/rule/model.js";
import { findingKey } from "../../domain/finding.js";
import { acceptFinding } from "../accept/handler.js";
import { proposeHandler } from "../propose/handler.js";
import { ProposeCommand } from "../propose/request.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { ProposalStore } from "../../shared/infrastructure/proposal-store.js";
import { Git, GitError } from "../../shared/infrastructure/git/service.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { normalizeChangeFixture } from "../../shared/pipeline/change-fixture.js";
import { encodeJson } from "../../shared/infrastructure/json.js";
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
            trackedBase: () => Effect.succeed(undefined),
            baseline: () => Effect.succeed({ ref: "main", commit: "main-merge-base" }),
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
          trackedBase: () => Effect.succeed(undefined),
          baseline: () => Effect.succeed({ ref: "main", commit: "main-merge-base" }),
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
      expect(failure).toMatchObject({ _tag: "agentlint/UnknownBindingError", bindingId: "missing" });
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

// Written by `agentlint accept 1` with agentlint 0.4.0 for the source below, with the same rule.
const recordedBy040 = encodeJson({
  schemaVersion: 1,
  source: {
    standardId: "security/danger",
    standardRevision: 1,
    detectorId: "typescript/danger-call",
    detectorVersion: 1,
    bindingId: "security/danger",
    bindingDigest: "b3097d01d66bb57c15a05389c0eefdb1d49498f91a6cd26dc67a47cb5d262f7f",
  },
  fingerprint: {
    scheme: "source-structure",
    version: 3,
    digest: "9cf881171642444731339e0228554fab70ad93e1418836124c54d6e521178bae",
  },
  lineageKey: "efd7a91990a48dc21a9f08360aecd7f5ae7a55fddd0faf41263338e11ac00cc8",
  reason: "Recorded by agentlint 0.4.0 for the migration test.",
  authority: "agent",
  actor: "agent:fixture",
  acceptedAt: "2026-09-30T22:38:52.762Z",
});
const reviewedSource = 'export const result = danger("x", { limit: 10 });\n';
const writeV3Store = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(join(cwd, ".agentlint"), { recursive: true });
  yield* fs.writeFileString(join(cwd, ".agentlint", "acceptances.jsonl"), `${recordedBy040}\n`);
}).pipe(Effect.provide(TestLayer));

describe("source-structure v3 decisions after the upgrade to v4", () => {
  it.effect("keeps the gate open and moves the decision to v4 on the first complete check", () =>
    Effect.gen(function* () {
      yield* writeSource(reviewedSource);
      yield* writeV3Store;
      const partial = yield* checkHandler(
        new CheckCommand({ all: false, rules: [], base: undefined, files: ["src/demo.ts"] }),
      ).pipe(Effect.provide(TestLayer));
      expect([partial.exitCode, partial.accepted.length, partial.migratedCount]).toEqual([0, 1, 0]);

      const first = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect([first.exitCode, first.accepted.length, first.staleCount, first.migratedCount]).toEqual([0, 1, 0, 1]);
      const [stored] = yield* readStoredAcceptances;
      expect(stored?.fingerprint).toEqual(first.findings[0]?.fingerprint);
      expect(stored?.fingerprint.version).toBe(4);
      expect([stored?.reason, stored?.actor, stored?.acceptedAt, stored?.authority]).toEqual([
        "Recorded by agentlint 0.4.0 for the migration test.",
        "agent:fixture",
        "2026-09-30T22:38:52.762Z",
        "agent",
      ]);

      const second = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect([second.exitCode, second.accepted.length, second.staleCount, second.migratedCount]).toEqual([0, 1, 0, 0]);

      // Once on v4, a reformat keeps the decision.
      yield* writeSource('export const result = danger(\n  "x",\n  {\n    limit: 10,\n  },\n)\n');
      const reformatted = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect([reformatted.exitCode, reformatted.accepted.length]).toEqual([0, 1]);
    }),
  );

  it.effect("drops a v3 decision whose evidence changed", () =>
    Effect.gen(function* () {
      yield* writeSource('export const result = danger("x", { limit: 11 });\n');
      yield* writeV3Store;
      const result = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect([result.exitCode, result.unresolved.length, result.staleCount, result.migratedCount]).toEqual([
        1, 1, 1, 0,
      ]);
      expect(yield* readStoredAcceptances).toEqual([]);
    }),
  );

  it.effect("cannot prove a v3 decision equivalent after a reformat that came first", () =>
    Effect.gen(function* () {
      // v3 digests formatting tokens, so it no longer matches; run one check on the upgrade before formatting.
      yield* writeSource('export const result = danger(\n  "x",\n  {\n    limit: 10,\n  },\n)\n');
      yield* writeV3Store;
      const result = yield* checkHandler(command).pipe(Effect.provide(TestLayer));
      expect([result.exitCode, result.unresolved.length]).toEqual([1, 1]);
    }),
  );
});

const readStoredAcceptances = Effect.gen(function* () {
  return (yield* (yield* AcceptanceStore).read()).records;
}).pipe(Effect.provide(TestLayer));

const trunk = "origin/main";
const parent = "feature/parent";
// Where HEAD left each ref. The parent branch already holds the migration, so only the trunk sees it change.
const mergeBases: Record<string, string> = { [trunk]: "trunk-merge-base", [parent]: "parent-merge-base" };
const migrationRule = ({ authority }: { readonly authority: "agent" | "human" }) =>
  defineRule({
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
    binding: { id: "database/safe-migration", authority, include: ["migrations/**"] },
  });
const checkAgainst = (base: string | undefined) => new CheckCommand({ all: true, rules: [], base, files: [] });

const branch = ({
  rules,
  trunkChange,
  tracked,
}: {
  readonly rules: ReadonlyArray<AgentlintRule>;
  readonly trunkChange: Record<string, string>;
  readonly tracked?: string;
}) =>
  Layer.mergeAll(
    Layer.succeed(ConfigLoader, ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig({ rules })) })),
    Layer.succeed(
      Git,
      Git.of({
        detectDefaultBranch: () => Effect.succeed(trunk),
        trackedBase: () => Effect.succeed(tracked),
        baseline: (baseRef = trunk) => Effect.succeed({ ref: baseRef, commit: mergeBases[baseRef] ?? "unknown" }),
        changedFiles: () => Effect.succeed([]),
        changeSet: (input) => {
          const ref = input?.baseRef ?? trunk;
          const change = normalizeChangeFixture({ before: {}, after: ref === trunk ? trunkChange : {} });
          return Effect.succeed({ ...change, baseline: { kind: "git", ref, commit: mergeBases[ref] } });
        },
      }),
    ),
  );
const withBranch =
  (layer: ReturnType<typeof branch>) =>
  <T, E, R>(effect: Effect.Effect<T, E, R>) =>
    effect.pipe(Effect.provide(layer), Effect.provide(TestLayer));
const storedProposals = Effect.flatMap(ProposalStore, (store) => store.read());

describe("records a check against another base cannot see", () => {
  it.effect("keeps a change acceptance through a check against a narrower base", () =>
    Effect.gen(function* () {
      yield* cleanup;
      const run = withBranch(
        branch({
          rules: [migrationRule({ authority: "agent" })],
          trunkChange: { "migrations/1.sql": "DROP TABLE users;" },
        }),
      );
      const first = yield* run(checkHandler(checkAgainst(trunk)));
      expect(first.unresolved).toHaveLength(1);
      yield* run(acceptFinding(A.getUnsafe(first.unresolved, 0), { authority: "agent", reason: "Table is unused." }));

      const narrow = yield* run(checkHandler(checkAgainst(parent)));
      expect(narrow).toMatchObject({ scope: "complete", findings: [], staleCount: 0, exitCode: 0 });
      expect(yield* readStoredAcceptances).toHaveLength(1);

      const again = yield* run(checkHandler(checkAgainst(trunk)));
      expect(again.accepted).toHaveLength(1);
      expect(again.exitCode).toBe(0);
    }),
  );

  it.effect("keeps a change acceptance through a check against the branch HEAD tracks", () =>
    Effect.gen(function* () {
      yield* cleanup;
      const rules = [migrationRule({ authority: "agent" })];
      const trunkChange = { "migrations/1.sql": "DROP TABLE users;" };
      const onTrunk = withBranch(branch({ rules, trunkChange }));
      const first = yield* onTrunk(checkHandler(checkAgainst(undefined)));
      yield* onTrunk(acceptFinding(A.getUnsafe(first.unresolved, 0), { authority: "agent", reason: "Unused." }));

      const stacked = yield* withBranch(branch({ rules, trunkChange, tracked: parent }))(
        checkHandler(checkAgainst(undefined)),
      );
      expect(stacked).toMatchObject({ scope: "complete", findings: [], staleCount: 0, exitCode: 0 });
      expect(yield* readStoredAcceptances).toHaveLength(1);
    }),
  );

  it.effect("keeps a change proposal through a check against a narrower base", () =>
    Effect.gen(function* () {
      yield* cleanup;
      const run = withBranch(
        branch({
          rules: [migrationRule({ authority: "human" })],
          trunkChange: { "migrations/1.sql": "DROP TABLE users;" },
        }),
      );
      const first = yield* run(checkHandler(checkAgainst(trunk)));
      const finding = A.getUnsafe(first.unresolved, 0);
      const proposed = yield* run(
        proposeHandler(
          new ProposeCommand({
            selector: findingKey(finding),
            summary: "Backfilled the table before the drop.",
            diff: undefined,
            base: trunk,
          }),
        ),
      );
      expect(proposed.exitCode).toBe(0);

      yield* run(checkHandler(checkAgainst(parent)));
      expect((yield* run(storedProposals)).map(findingKey)).toEqual([findingKey(finding)]);

      const again = yield* run(checkHandler(checkAgainst(trunk)));
      expect(again.unresolved.map(findingKey)).toEqual([findingKey(finding)]);
      expect((yield* run(storedProposals)).map(findingKey)).toEqual([findingKey(finding)]);
    }),
  );

  it.effect("keeps a change acceptance when Git cannot resolve the default branch", () =>
    Effect.gen(function* () {
      yield* cleanup;
      const rules = [migrationRule({ authority: "agent" })];
      const run = withBranch(branch({ rules, trunkChange: { "migrations/1.sql": "DROP TABLE users;" } }));
      const first = yield* run(checkHandler(checkAgainst(trunk)));
      yield* run(acceptFinding(A.getUnsafe(first.unresolved, 0), { authority: "agent", reason: "Unused." }));

      const noDefault = new GitError({ reason: "no_default_branch", operation: "default branch detection" });
      const withoutDefault = Layer.succeed(
        Git,
        Git.of({
          detectDefaultBranch: () => Effect.fail(noDefault),
          trackedBase: () => Effect.succeed(undefined),
          baseline: (baseRef) =>
            baseRef === undefined
              ? Effect.fail(noDefault)
              : Effect.succeed({ ref: baseRef, commit: "parent-merge-base" }),
          changedFiles: () => Effect.succeed([]),
          changeSet: () =>
            Effect.succeed({
              ...normalizeChangeFixture({ before: {}, after: {} }),
              baseline: { kind: "git", ref: parent, commit: "parent-merge-base" },
            }),
        }),
      );
      const narrow = yield* run(checkHandler(checkAgainst(parent)).pipe(Effect.provide(withoutDefault)));
      expect(narrow.staleCount).toBe(0);
      expect(yield* readStoredAcceptances).toHaveLength(1);
    }),
  );

  it.effect("still prunes a stale state acceptance through a check against a narrower base", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* writeSource('danger("x")\n');
      const run = withBranch(
        branch({
          rules: [rule, migrationRule({ authority: "agent" })],
          trunkChange: { "migrations/1.sql": "DROP TABLE users;" },
        }),
      );
      const first = yield* run(checkHandler(checkAgainst(trunk)));
      expect(first.unresolved.map((finding) => finding.lifecycle).toSorted()).toEqual(["change", "state"]);
      yield* Effect.forEach(first.unresolved, (finding) =>
        run(acceptFinding(finding, { authority: "agent", reason: "Reviewed." })),
      );
      yield* writeSource('danger("x", "new evidence")\n');

      const narrow = yield* run(checkHandler(checkAgainst(parent)));
      expect(narrow.staleCount).toBe(1);
      expect((yield* readStoredAcceptances).map((record) => record.fingerprint.scheme)).toEqual(["git-change"]);
    }),
  );

  it.effect("prunes a change acceptance once a check against the default branch's merge base no longer finds it", () =>
    Effect.gen(function* () {
      yield* cleanup;
      const pending = withBranch(
        branch({
          rules: [migrationRule({ authority: "agent" })],
          trunkChange: { "migrations/1.sql": "DROP TABLE users;" },
        }),
      );
      const first = yield* pending(checkHandler(checkAgainst(undefined)));
      yield* pending(acceptFinding(A.getUnsafe(first.unresolved, 0), { authority: "agent", reason: "Unused." }));

      // The migration reached the trunk: no base shows it any more.
      const merged = withBranch(branch({ rules: [migrationRule({ authority: "agent" })], trunkChange: {} }));
      const narrow = yield* merged(checkHandler(checkAgainst(parent)));
      expect(narrow.staleCount).toBe(0);
      expect(yield* readStoredAcceptances).toHaveLength(1);

      // `--base` names the default branch here: the same merge base, so the same view.
      const complete = yield* merged(checkHandler(checkAgainst(trunk)));
      expect(complete.staleCount).toBe(1);
      expect(yield* readStoredAcceptances).toEqual([]);
    }),
  );
});

const appendToStore = (file: "acceptances.jsonl" | "proposals.jsonl", line: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = join(cwd, ".agentlint", file);
    const existing = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    yield* fs.writeFileString(path, `${existing}${line}\n`);
  }).pipe(Effect.provide(TestLayer));

describe("v3 migration in a check against another merge base", () => {
  const layer = branch({
    rules: [rule, migrationRule({ authority: "agent" })],
    trunkChange: { "migrations/1.sql": "DROP TABLE users;" },
  });
  const run = withBranch(layer);

  /**
   * A change acceptance recorded against the trunk, then the v3 state acceptance an earlier version wrote.
   */
  const recordBoth = Effect.gen(function* () {
    const first = yield* run(checkHandler(checkAgainst(trunk)));
    const change = A.getUnsafe(
      first.unresolved.filter((finding) => finding.lifecycle === "change"),
      0,
    );
    yield* run(acceptFinding(change, { authority: "agent", reason: "Table is unused." }));
    yield* appendToStore("acceptances.jsonl", recordedBy040);
    return change;
  });

  it.effect("moves a matching v3 state acceptance to v4 and leaves the change acceptance as it was", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* writeSource(reviewedSource);
      const change = yield* recordBoth;
      const before = (yield* readStoredAcceptances).find((record) => record.fingerprint.scheme === "git-change");

      const narrow = yield* run(checkHandler(checkAgainst(parent)));
      expect([narrow.exitCode, narrow.staleCount, narrow.migratedCount]).toEqual([0, 0, 1]);
      const stored = yield* readStoredAcceptances;
      expect(stored.map((record) => [record.fingerprint.scheme, record.fingerprint.version]).toSorted()).toEqual([
        ["git-change", 2],
        ["source-structure", 4],
      ]);
      // Neither re-keyed nor removed: the narrower base cannot see the change finding.
      expect(stored.find((record) => record.fingerprint.scheme === "git-change")).toEqual(before);
      expect(stored.find((record) => record.fingerprint.scheme === "source-structure")?.reason).toBe(
        "Recorded by agentlint 0.4.0 for the migration test.",
      );

      const trunkCheck = yield* run(checkHandler(checkAgainst(trunk)));
      expect([trunkCheck.exitCode, trunkCheck.accepted.map(findingKey).toSorted()]).toEqual([
        0,
        [findingKey(change), findingKey(A.getUnsafe(narrow.accepted, 0))].toSorted(),
      ]);
    }),
  );

  it.effect("removes a v3 state acceptance whose evidence changed and keeps the change acceptance", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* writeSource('export const result = danger("x", { limit: 11 });\n');
      yield* recordBoth;

      const narrow = yield* run(checkHandler(checkAgainst(parent)));
      expect([narrow.exitCode, narrow.staleCount, narrow.migratedCount]).toEqual([1, 1, 0]);
      expect((yield* readStoredAcceptances).map((record) => record.fingerprint.scheme)).toEqual(["git-change"]);
    }),
  );

  it.effect("moves a v3 state proposal and keeps a change proposal through a narrower base", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* writeSource(reviewedSource);
      const first = yield* run(checkHandler(checkAgainst(trunk)));
      const propose = (finding: FindingRecordLike) =>
        run(
          proposeHandler(
            new ProposeCommand({ selector: findingKey(finding), summary: "Proposed.", diff: undefined, base: trunk }),
          ),
        );
      for (const finding of first.unresolved) expect((yield* propose(finding)).exitCode).toBe(0);
      const state = A.getUnsafe(
        first.unresolved.filter((finding) => finding.lifecycle === "state"),
        0,
      );
      const legacy = A.getUnsafe(state.legacyFingerprints ?? [], 0);
      // Rewrite the state proposal as an earlier version stored it.
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = join(cwd, ".agentlint", "proposals.jsonl");
        const content = yield* fs.readFileString(path);
        yield* fs.writeFileString(
          path,
          content.replace(state.fingerprint.digest, legacy.digest).replace('"version":4', '"version":3'),
        );
      }).pipe(Effect.provide(TestLayer));

      yield* run(checkHandler(checkAgainst(parent)));
      expect((yield* run(storedProposals)).map(findingKey).toSorted()).toEqual(
        first.unresolved.map(findingKey).toSorted(),
      );
    }),
  );
});

type FindingRecordLike = Parameters<typeof findingKey>[0];
