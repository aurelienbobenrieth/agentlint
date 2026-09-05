// @ts-check
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { decodeArtifact } from "../src/artifact.mjs";
import {
  countFindings,
  digestFromBody,
  renderAnnotations,
  renderCheckOutput,
  renderInlineBody,
  renderSummary,
  renderWorkflowCommands,
} from "../src/render.mjs";

async function findings() {
  const raw = JSON.parse(await readFile(new URL("./fixtures/artifact.json", import.meta.url), "utf8"));
  return decodeArtifact(raw).findings;
}

describe("render", () => {
  it("renders the sticky summary with links, commands, and out-of-diff findings", async () => {
    const all = await findings();
    const summary = renderSummary({
      repository: "aurelienbobenrieth/agentlint",
      headSha: "abcdef1234567890abcdef1234567890abcdef12",
      pullNumber: 42,
      gate: "closed",
      findings: all,
      inlineDigests: new Set([all[0]?.digest ?? "", all[2]?.digest ?? ""]),
    });
    expect(summary.startsWith("<!-- agentlint:summary -->")).toBe(true);
    expect(summary).toContain(
      "https://github.com/aurelienbobenrieth/agentlint/blob/abcdef1234567890abcdef1234567890abcdef12/src/vendor/legacy-parser.js#L3",
    );
    expect(summary).toContain('/agentlint approve dd03e1e41c97 --reason "..."');
    expect(summary).toContain('agentlint accept 103d435f608a --reason "..."');
    expect(summary).toContain("agentlint pr 42");
    expect(summary).toContain("`src/migrations/2026-07-drop-legacy-users.ts:4`");
    expect(summary).toMatchSnapshot();
  });

  it("renders inline bodies with the marker first and the right reply instruction", async () => {
    const [withProposal, withLineage, agent] = await findings();
    if (!withProposal || !withLineage || !agent) throw new Error("fixture");
    const human = renderInlineBody(withProposal);
    expect(human.startsWith(`<!-- agentlint:${withProposal.digest} -->`)).toBe(true);
    expect(digestFromBody(human)).toBe(withProposal.digest);
    expect(human).toContain("```diff");
    expect(human).toContain('Reply "/agentlint approve <reason>" to accept.');
    expect(human).toMatchSnapshot();

    expect(renderInlineBody(withLineage)).toContain("Prior judgment (context only)");
    expect(renderInlineBody(agent)).toContain('agentlint accept 103d435f608a --reason "..."');
    expect(renderInlineBody(agent)).not.toContain("<details>");
  });

  it("renders annotations, check output, and counts", async () => {
    const all = await findings();
    const annotations = renderAnnotations(all);
    expect(annotations.map((annotation) => annotation.annotation_level)).toEqual(["failure", "failure", "warning"]);
    expect(annotations[0]).toMatchObject({ path: "src/vendor/legacy-parser.js", start_line: 3, end_line: 3 });
    expect(countFindings(all)).toEqual({ unresolved: 3, human: 2, agent: 1, accepted: 0 });
    expect(renderCheckOutput("closed", all).title).toBe("Gate closed: 3 unresolved");
    expect(renderCheckOutput("open", []).title).toBe("Gate open");
    expect(renderCheckOutput("error", []).title).toBe("agentlint could not run");
  });

  it("escapes workflow command properties and data", async () => {
    const all = await findings();
    const lines = renderWorkflowCommands(all);
    expect(lines[0]).toBe(
      "::error file=src/vendor/legacy-parser.js,line=3,col=10,title=Dynamic code execution has an explicit trust boundary::Runtime input reaches dynamic code execution.",
    );
    expect(lines[2]?.startsWith("::warning ")).toBe(true);
    const first = all[0];
    if (!first) throw new Error("fixture");
    const tricky = renderWorkflowCommands([{ ...first, ruleTitle: "a:b,c", message: "x%\ny" }]);
    expect(tricky[0]).toContain("title=a%3Ab%2Cc::x%25%0Ay");
  });
});
