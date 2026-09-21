import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { normalizeConfig } from "../../domain/config.js";
import { defineRule } from "../../domain/rule.js";
import { acceptFinding } from "../accept/handler.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { normalizeChangeFixture } from "../../shared/pipeline/change-fixture.js";
import { checkHandler } from "./handler.js";
import { CheckCommand } from "./request.js";

const cwd = join(tmpdir(), "agentlint-v02-check-test");
const rule = defineRule({
  lifecycle: "state",
  standard: { id: "security/danger", revision: 1, title: "Danger is reviewed", guidance: "Review danger calls." },
  detector: {
    id: "typescript/danger-call",
    version: 1,
    match: { pattern: "danger($$$ARGS)", message: "danger needs judgment" },
  },
  binding: { id: "security/danger", authority: "agent", include: ["src/**/*.ts"] },
});
const TestEnv = Layer.succeed(
  Env,
  Env.of({ cwd, argv: [], actor: "agent:test", platform: "test", noColor: true, isTTY: false, setExitCode: () => {} }),
);
const TestConfig = Layer.succeed(
  ConfigLoader,
  ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig({ rules: [rule] })) }),
);
const TestGit = Layer.succeed(
  Git,
  Git.of({
    detectDefaultBranch: () => Effect.succeed("main"),
    changedFiles: () => Effect.succeed([]),
    changeSet: () => Effect.succeed({ baseline: { kind: "git", ref: "main" }, files: [] }),
  }),
);
const TestLayer = Layer.mergeAll(TestConfig, TestGit, Parser.layer, AcceptanceStore.layer, SelectorCache.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(TestEnv),
);
const command = new CheckCommand({ all: true, rules: [], base: undefined, files: [] });

const writeSource = (source: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
    yield* fs.writeFileString(path.resolve(cwd, "src", "demo.ts"), source);
  }).pipe(Effect.provide(TestLayer));
const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
}).pipe(Effect.provide(TestLayer));

afterEach(() => Effect.runPromise(cleanup));

describe("binary check and acceptance loop", () => {
  it("scans dependent state files even when Git reports no source change", async () => {
    await Effect.runPromise(writeSource('danger("x")'));
    await Effect.runPromise(
      Effect.flatMap(FileSystem.FileSystem, (fs) =>
        fs.writeFileString(join(cwd, "policy.txt"), "sandbox required"),
      ).pipe(Effect.provide(TestLayer)),
    );
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
    const result = await Effect.runPromise(
      checkHandler(new CheckCommand({ ...command, all: false })).pipe(
        Effect.provide(config),
        Effect.provide(TestLayer),
      ),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.scannedFiles).toEqual(["src/demo.ts"]);
    expect(result.scope).toBe("partial");
  });

  it("does not replace the complete-scan selector cache from a partial scan", async () => {
    await Effect.runPromise(writeSource('danger("x")'));
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
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const selectors = yield* SelectorCache;
        yield* selectors.write(cached);
        const checked = yield* checkHandler(new CheckCommand({ ...command, rules: [rule.binding.id] }));
        return { checked, cache: yield* selectors.read() };
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.checked.scope).toBe("partial");
    expect(result.checked.unresolved[0]?.selector).toMatch(/^[0-9a-f]{12}$/);
    expect(result.cache.findings).toEqual(cached);
  });

  it("applies change rules to explicit files in every path form the state resolver accepts", async () => {
    const dropColumn = defineRule({
      lifecycle: "change",
      standard: { id: "database/safe-migration", revision: 1, title: "Migrations", guidance: "Review drops." },
      detector: {
        id: "sql/drop",
        version: 1,
        detect(context) {
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
            Effect.succeed(normalizeChangeFixture({ before: {}, after: { "migrations/1.sql": "DROP TABLE users;" } })),
        }),
      ),
    );
    const findingsFor = async (files: ReadonlyArray<string>) =>
      (
        await Effect.runPromise(
          checkHandler(new CheckCommand({ ...command, all: false, files })).pipe(
            Effect.provide(layers),
            Effect.provide(TestLayer),
          ),
        )
      ).findings.map((finding) => finding.file);

    const forms = ["migrations/1.sql", "./migrations/1.sql", "migrations\\1.sql", "migrations", "migrations/*.sql"];
    const reported = await Promise.all(forms.map((form) => findingsFor([form])));
    expect(Object.fromEntries(forms.map((form, index) => [form, reported[index]]))).toEqual(
      Object.fromEntries(forms.map((form) => [form, ["migrations/1.sql"]])),
    );
    expect(await findingsFor([join(cwd, "migrations", "1.sql")])).toEqual(["migrations/1.sql"]);
    expect(await findingsFor(["other"])).toEqual([]);
  });

  it("does not load change snapshots for file-local state detectors", async () => {
    await Effect.runPromise(writeSource('danger("x")'));
    const git = Layer.succeed(
      Git,
      Git.of({
        detectDefaultBranch: () => Effect.succeed("main"),
        changedFiles: () => Effect.succeed(["src/demo.ts"]),
        changeSet: () => Effect.die("State-only scans must not load snapshots"),
      }),
    );
    const result = await Effect.runPromise(
      checkHandler(new CheckCommand({ ...command, all: false })).pipe(Effect.provide(git), Effect.provide(TestLayer)),
    );
    expect(result.findings).toHaveLength(1);
  });

  it("fails incomplete syntax without pruning existing decisions", async () => {
    await Effect.runPromise(writeSource('danger("x")'));
    const [finding] = (await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)))).findings;
    if (!finding) throw new Error("Expected finding");
    await Effect.runPromise(
      acceptFinding(finding, { authority: "agent", reason: "Reviewed." }).pipe(Effect.provide(TestLayer)),
    );
    await Effect.runPromise(writeSource('danger("x"'));
    await expect(Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)))).rejects.toMatchObject({
      reason: "parse_failed",
    });
    expect(await Effect.runPromise(readStoredAcceptances)).toHaveLength(1);
  });

  it("keeps all separately accepted calls open", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(writeSource('danger("x"); danger("y"); danger("x");'));
    const first = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    await Effect.runPromise(
      Effect.forEach(first.findings, (finding) =>
        acceptFinding(finding, { authority: "agent", reason: "Reviewed independently." }),
      ).pipe(Effect.provide(TestLayer)),
    );
    const result = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    expect(result.exitCode).toBe(0);
    expect(result.accepted).toHaveLength(3);
  });

  it("fails missing paths without removing acceptance state", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(writeSource('danger("x")'));
    const first = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    const finding = first.findings[0];
    if (!finding) throw new Error("Expected finding");
    await Effect.runPromise(
      acceptFinding(finding, { authority: "agent", reason: "Reviewed." }).pipe(Effect.provide(TestLayer)),
    );
    await expect(
      Effect.runPromise(
        checkHandler(new CheckCommand({ ...command, files: ["src/missing.ts"] })).pipe(Effect.provide(TestLayer)),
      ),
    ).rejects.toMatchObject({ reason: "filesystem" });
    expect(await Effect.runPromise(readStoredAcceptances)).toHaveLength(1);
  });

  it("rejects unknown bindings instead of silently running a subset", async () => {
    await expect(
      Effect.runPromise(
        checkHandler(new CheckCommand({ ...command, rules: [rule.binding.id, "missing"] })).pipe(
          Effect.provide(TestLayer),
        ),
      ),
    ).rejects.toMatchObject({ ruleId: "missing" });
  });
  it("preserves formatting-only decisions and invalidates material evidence with transient lineage", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(writeSource('danger("x")\n'));

    const first = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    expect(first.exitCode).toBe(1);
    expect(first.unresolved).toHaveLength(1);

    const finding = first.unresolved[0];
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    await Effect.runPromise(
      acceptFinding(finding, { authority: "agent", reason: "The sandbox owns this call." }).pipe(
        Effect.provide(TestLayer),
      ),
    );
    await Effect.runPromise(writeSource('\n\n  danger( "x" )\n'));
    const moved = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    expect(moved.exitCode).toBe(0);
    expect(moved.accepted).toHaveLength(1);

    await Effect.runPromise(writeSource('danger("x", "new evidence")\n'));
    const changed = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    expect(changed.exitCode).toBe(1);
    expect(changed.lineage).toMatchObject([{ reason: "The sandbox owns this call.", authority: "agent" }]);
    expect(changed.staleCount).toBe(1);
    expect(await Effect.runPromise(readStoredAcceptances)).toEqual([]);
  });

  it("prunes stale acceptances only for a complete view", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(writeSource('danger("x")\n'));
    const first = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    const finding = first.unresolved[0];
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    await Effect.runPromise(
      acceptFinding(finding, { authority: "agent", reason: "The sandbox owns this call." }).pipe(
        Effect.provide(TestLayer),
      ),
    );
    // New evidence: the stored acceptance no longer matches any current finding.
    await Effect.runPromise(writeSource('danger("x", "new evidence")\n'));

    const partialCommands = [
      new CheckCommand({ all: true, rules: ["security/danger"], base: undefined, files: [] }),
      new CheckCommand({ all: true, rules: [], base: undefined, files: ["src/demo.ts"] }),
      new CheckCommand({ all: false, rules: [], base: undefined, files: ["src/demo.ts"] }),
    ];
    const partialRuns = await Effect.runPromise(
      Effect.forEach(partialCommands, (partial) =>
        Effect.all({
          result: checkHandler(partial),
          stored: Effect.flatMap(AcceptanceStore, (store) => store.read()).pipe(
            Effect.map((snapshot) => snapshot.records),
          ),
        }),
      ).pipe(Effect.provide(TestLayer)),
    );
    for (const { result, stored } of partialRuns) {
      expect(result.scope).toBe("partial");
      expect(result.exitCode).toBe(1);
      expect(result.staleCount).toBe(0);
      expect(stored).toHaveLength(1);
    }

    const complete = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    expect(complete.scope).toBe("complete");
    expect(complete.staleCount).toBe(1);
    expect(await Effect.runPromise(readStoredAcceptances)).toEqual([]);
  });
});

const readStoredAcceptances = Effect.gen(function* () {
  return (yield* (yield* AcceptanceStore).read()).records;
}).pipe(Effect.provide(TestLayer));
