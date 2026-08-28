import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Env } from "../config/env.js";
import { normalizeConfig } from "../domain/config.js";
import { FindingRecord, findingKey } from "../domain/finding.js";
import { Fingerprint, FindingSource } from "../domain/fingerprint.js";
import { defineRule } from "../domain/rule.js";
import { formatCheckJsonl, formatCheckText } from "./reporter.js";

const dangerRule = defineRule({
  lifecycle: "state",
  standard: {
    id: "security/danger",
    revision: 1,
    title: "Danger calls need judgment",
    guidance: "Every danger call must be reviewed against the repository's security boundary.",
  },
  detector: { id: "typescript/danger", version: 1, match: { pattern: "danger($$$ARGS)", message: "Review danger" } },
  binding: { id: "security/danger", authority: "agent" },
});

const deletionRule = defineRule({
  lifecycle: "change",
  standard: {
    id: "data/destructive-change",
    revision: 1,
    title: "Destructive changes need human review",
    guidance: "A human must review every destructive data change.",
  },
  detector: { id: "git/destructive-change", version: 1, detect: () => undefined },
  binding: { id: "data/destructive-change", authority: "human" },
});

const config = normalizeConfig({ rules: [dangerRule, deletionRule] });
const env = Layer.succeed(
  Env,
  Env.of({
    cwd: "C:/repo",
    argv: [],
    actor: "agent:test",
    platform: "test",
    noColor: true,
    isTTY: false,
    setExitCode: () => undefined,
  }),
);

function finding(options: {
  selector: string;
  ruleId?: string;
  lifecycle?: "state" | "change";
  authority?: "agent" | "human";
  file: string;
  line: number;
  message: string;
  digest: string;
}) {
  const ruleId = options.ruleId ?? "security/danger";
  return new FindingRecord({
    selector: options.selector,
    ruleId,
    lifecycle: options.lifecycle ?? "state",
    authority: options.authority ?? "agent",
    source: new FindingSource({
      standardId: ruleId,
      standardRevision: 1,
      detectorId: ruleId === "security/danger" ? "typescript/danger" : "git/destructive-change",
      detectorVersion: 1,
      bindingId: ruleId,
      bindingDigest: "binding-digest",
    }),
    fingerprint: new Fingerprint({ scheme: "test", version: 1, digest: options.digest }),
    lineageKey: undefined,
    file: options.file,
    absolutePath: `C:/repo/${options.file}`,
    line: options.line,
    column: 3,
    endLine: options.line,
    endColumn: 12,
    message: options.message,
    sourceSnippet: `danger(${options.digest})`,
  });
}

describe("check reporter", () => {
  it("groups compact human output by rule without repeating standards or snippets", async () => {
    const first = finding({ selector: "f1", file: "src/a.ts", line: 4, message: "Review the first call", digest: "a" });
    const second = finding({
      selector: "f2",
      file: "src/b.ts",
      line: 9,
      message: "Review the second call",
      digest: "b",
    });
    const human = finding({
      selector: "f3",
      ruleId: "data/destructive-change",
      lifecycle: "change",
      authority: "human",
      file: "migrations/drop.sql",
      line: 1,
      message: "Review the dropped table",
      digest: "c",
    });

    const output = await Effect.runPromise(
      formatCheckText([first, human, second], config, "0.2.0").pipe(Effect.provide(env)),
    );

    expect(output).toContain("security/danger — Danger calls need judgment (2 findings, state/agent)");
    expect(output).toContain("[f1] src/a.ts:4:3 — Review the first call");
    expect(output).toContain("[f2] src/b.ts:9:3 — Review the second call");
    expect(output).toContain('Actions: agentlint explain security/danger · agentlint accept <finding> --reason "..."');
    expect(output).toContain(
      "data/destructive-change — Destructive changes need human review (1 finding, change/human)",
    );
    expect(output).toContain("Actions: agentlint explain data/destructive-change · agentlint review");
    expect(output).not.toContain("Standard:");
    expect(output).not.toContain("danger(a)");
    expect(output.match(/security\/danger —/g)).toHaveLength(1);
  });

  it("keeps prior judgment beside only its related finding", async () => {
    const first = finding({ selector: "f1", file: "src/a.ts", line: 4, message: "Review the first call", digest: "a" });
    const second = finding({
      selector: "f2",
      file: "src/b.ts",
      line: 9,
      message: "Review the second call",
      digest: "b",
    });
    const output = await Effect.runPromise(
      formatCheckText([first, second], config, "0.2.0", [
        {
          findingKey: findingKey(second),
          acceptanceId: "acceptance-1",
          reason: "The sandbox owns this path.",
          authority: "agent",
          acceptedAt: "2026-08-11T10:00:00.000Z",
        },
      ]).pipe(Effect.provide(env)),
    );

    expect(output.match(/Prior judgment/g)).toHaveLength(1);
    expect(output).toContain(
      "Prior judgment (context only): The sandbox owns this path. (agent, 2026-08-11T10:00:00.000Z)",
    );
  });

  it("retains full-fidelity JSONL fields", () => {
    const item = finding({ selector: "f1", file: "src/a.ts", line: 4, message: "Review the call", digest: "a" });
    const output = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
      formatCheckJsonl([item], config),
    ) as Record<string, unknown>;

    expect(output).toMatchObject({
      version: 1,
      type: "finding",
      selector: "f1",
      message: "Review the call",
      snippet: "danger(a)",
      standard: "Every danger call must be reviewed against the repository's security boundary.",
      commands: {
        explain: "agentlint explain f1",
        decide: 'agentlint accept f1 --reason "..."',
      },
    });
  });
});
