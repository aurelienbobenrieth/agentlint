import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { normalizeConfig, type AgentlintConfig } from "../../domain/config.js";
import { defineRule, type ChangeSet } from "../../domain/rule.js";
import { testRuleOnChange, testRuleOnSource, testRuleOnSources } from "../../testing.js";
import { ConfigLoader } from "../infrastructure/config-loader.js";
import { Git } from "../infrastructure/git.js";
import { Parser } from "../infrastructure/parser.js";
import { normalizeChangeFixture } from "./change-fixture.js";
import { collectFindings, collectStateFindings, ruleEnabledForFile, type ScanCapture } from "./collect-findings.js";

const standard = { id: "security/danger", revision: 1, title: "Danger is reviewed", guidance: "Review it." } as const;

const danger = (binding: { include?: string[]; exclude?: string[]; dependencies?: string[] } = {}) =>
  defineRule({
    lifecycle: "state",
    standard,
    detector: { id: "typescript/danger", version: 1, match: { pattern: "danger($$$ARGS)", message: "Review danger." } },
    binding: { id: "security/danger", authority: "agent", ...binding },
  });

const everyChange = (binding: { include?: string[] } = {}) =>
  defineRule({
    lifecycle: "change",
    standard,
    detector: {
      id: "change/every-file",
      version: 1,
      detect(context) {
        for (const changed of context.change.files)
          context.report({
            key: changed.path,
            file: changed.path,
            message: "Review this change.",
            evidence: { content: changed.after?.content ?? null, digest: changed.after?.digest ?? null },
          });
      },
    },
    binding: { id: "change/every-file", authority: "human", ...binding },
  });

interface Scenario {
  readonly files: Record<string, string>;
  readonly config: AgentlintConfig;
  readonly change?: ChangeSet;
  readonly onChangeSet?: (include: ((path: string) => boolean) | undefined) => void;
}

async function collect(scenario: Scenario, prepare?: (cwd: string) => void) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "agentlint-collect-")));
  try {
    for (const [file, content] of Object.entries(scenario.files)) {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), content);
    }
    prepare?.(cwd);
    const change = scenario.change ?? { baseline: { kind: "git" as const, ref: "main" }, files: [] };
    const layer = Layer.mergeAll(
      Layer.succeed(ConfigLoader, ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig(scenario.config)) })),
      Layer.succeed(
        Git,
        Git.of({
          detectDefaultBranch: () => Effect.succeed("main"),
          changedFiles: () => Effect.succeed([]),
          changeSet: (_base, include) => {
            scenario.onChangeSet?.(include);
            return Effect.succeed({ ...change, files: change.files.filter((file) => include?.(file.path) ?? true) });
          },
        }),
      ),
      Parser.layer,
    ).pipe(
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(
        Layer.succeed(
          Env,
          Env.of({
            cwd,
            argv: [],
            actor: "agent:test",
            platform: "test",
            noColor: true,
            isTTY: false,
            setExitCode: () => {},
          }),
        ),
      ),
    );
    return await Effect.runPromise(
      collectFindings({ all: true, rules: [], base: undefined, files: [] }).pipe(Effect.provide(layer)),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("binding scope", () => {
  it("matches dotfiles and dot directories for state rules", async () => {
    const rule = danger({ include: ["src/**"], exclude: ["src/.skipped/**"] });
    expect(ruleEnabledForFile(rule, "src/.hidden/x.ts")).toBe(true);
    const result = await collect({
      files: {
        "src/.hidden/x.ts": "danger(1);\n",
        "src/.x.ts": "danger(2);\n",
        "src/.skipped/y.ts": "danger(3);\n",
      },
      config: { rules: [rule] },
    });
    expect(result.findings.map((finding) => finding.file)).toEqual(["src/.hidden/x.ts", "src/.x.ts"]);
  });

  it("matches dotfiles for change rules and for config ignores", async () => {
    const after = { "src/.hidden/x.ts": "a();\n", "src/.x.ts": "b();\n", "src/.generated/z.ts": "c();\n" };
    const result = await collect({
      files: after,
      config: { rules: [everyChange({ include: ["src/**"] })], ignores: ["src/.generated/**"] },
      change: normalizeChangeFixture({ after }),
    });
    expect(result.findings.map((finding) => finding.file)).toEqual(["src/.hidden/x.ts", "src/.x.ts"]);
  });
});

describe("change set selection", () => {
  it("asks Git only for files a change rule can see", async () => {
    const after = { "src/a.ts": "a();\n", "assets/huge.bin": "x", "docs/guide.md": "# guide\n" };
    let include: ((path: string) => boolean) | undefined;
    await collect({
      files: after,
      config: { rules: [everyChange({ include: ["src/**", "assets/**"] })], ignores: ["assets/**"] },
      change: normalizeChangeFixture({ after }),
      onChangeSet: (predicate) => (include = predicate),
    });
    expect(Object.keys(after).filter((file) => include?.(file))).toEqual(["src/a.ts"]);
  });
});

describe("line endings", () => {
  const source = [
    "// a comment",
    "/* a block",
    "   comment */",
    "const text = `first",
    "second`;",
    "danger(text);",
    "",
  ];
  const lf = source.join("\n");
  const crlf = source.join("\r\n");

  it("fingerprints a CRLF checkout like an LF checkout, on the same lines", async () => {
    const rule = danger();
    const [left] = await testRuleOnSource(rule, lf, "fixture.ts");
    const [right] = await testRuleOnSource(rule, crlf, "fixture.ts");
    expect(left).toBeDefined();
    expect(right?.fingerprint).toEqual(left?.fingerprint);
    expect([right?.line, right?.column, right?.endLine]).toEqual([left?.line, left?.column, left?.endLine]);
    expect(left?.line).toBe(6);
  });

  it("digests a CRLF dependency like an LF dependency", async () => {
    const rule = danger({ dependencies: ["policy.txt"] });
    const run = (policy: string) =>
      testRuleOnSources(rule, [
        ["policy.txt", policy],
        ["src/a.ts", "danger(1);\n"],
      ]);
    const [left] = await run("sandbox\nrequired\n");
    const [right] = await run("sandbox\r\nrequired\r\n");
    const [other] = await run("sandbox\noptional\n");
    expect(right?.fingerprint).toEqual(left?.fingerprint);
    expect(other?.fingerprint).not.toEqual(left?.fingerprint);
  });

  it("gives change fixtures the same evidence for both line endings", async () => {
    const rule = everyChange();
    const [left] = await testRuleOnChange(rule, { after: { "a.sql": "DROP TABLE a;\nSELECT 1;\n" } });
    const [right] = await testRuleOnChange(rule, { after: { "a.sql": "DROP TABLE a;\r\nSELECT 1;\r\n" } });
    expect(right?.fingerprint).toEqual(left?.fingerprint);
  });

  it("reads scanned files from disk with normalized line endings", async () => {
    const left = await collect({ files: { "src/a.ts": lf }, config: { rules: [danger()] } });
    const right = await collect({ files: { "src/a.ts": crlf }, config: { rules: [danger()] } });
    expect(right.findings[0]?.fingerprint).toEqual(left.findings[0]?.fingerprint);
    expect(right.sources["src/a.ts"]).toBe(lf);
  });

  it("fails on a fixture dependency that was not supplied", async () => {
    await expect(
      testRuleOnSources(danger({ dependencies: ["policy.txt"] }), [["src/a.ts", "danger(1);\n"]]),
    ).rejects.toThrow("Missing fixture dependency: policy.txt");
  });
});

describe("incomplete scans", () => {
  it("names every unparseable file in one failure, after analysing the rest", async () => {
    const result = collect({
      files: { "src/a.ts": "danger(", "src/b.ts": "danger(1);\n", "src/c.tsx": "const x = <div>;\n" },
      config: { rules: [danger()] },
    });
    await expect(result).rejects.toMatchObject({
      _tag: "agentlint/UnparseableFilesError",
      reason: "parse_failed",
      files: [
        { file: "src/a.ts", grammar: "typescript" },
        { file: "src/c.tsx", grammar: "tsx" },
      ],
    });
    await expect(result).rejects.toThrow(/2 files:\n {2}src\/a\.ts \(typescript\)\n {2}src\/c\.tsx \(tsx\)$/);
  });

  it("refuses a dependency that resolves outside the repository", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "agentlint-collect-outside-")));
    try {
      writeFileSync(join(outside, "secret.txt"), "SECRET\n");
      await expect(
        collect(
          {
            files: { "src/a.ts": "danger(1);\n" },
            config: { rules: [danger({ dependencies: ["linked/secret.txt"] })], ignores: ["linked"] },
          },
          (cwd) =>
            // A junction needs no privilege on Windows; elsewhere Node creates a directory symlink.
            symlinkSync(outside, join(cwd, "linked"), "junction"),
        ),
      ).rejects.toThrow("linked/secret.txt: resolves outside the repository");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("captured sources", () => {
  it("keeps the text of files with findings and only the names of the others", async () => {
    const capture: ScanCapture = { scanned: new Set(), sources: new Map() };
    const sources = new Map([
      ["src/a.ts", "danger(1);\n"],
      ["src/b.ts", "safe();\n"],
    ]);
    const env = Env.of({
      cwd: tmpdir(),
      argv: [],
      actor: "agent:test",
      platform: "test",
      noColor: true,
      isTTY: false,
      setExitCode: () => {},
    });
    await Effect.runPromise(
      collectStateFindings([danger()], [...sources.keys()], sources, capture).pipe(
        Effect.provide(Parser.layer),
        Effect.provide(NodeServices.layer),
        Effect.provide(Layer.succeed(Env, env)),
      ),
    );
    expect([...capture.scanned]).toEqual(["src/a.ts", "src/b.ts"]);
    expect([...capture.sources.keys()]).toEqual(["src/a.ts"]);
  });
});
