// @ts-check
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { decodeArtifact } from "../src/artifact.mjs";
import {
  BODY_BUDGET,
  codeSpan,
  countFindings,
  digestFromBody,
  fenced,
  headFromSummary,
  plain,
  renderAnnotations,
  renderCheckOutput,
  renderFailureReply,
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
    expect(renderCheckOutput({ gate: "closed", findings: all }).title).toBe("Gate closed: 3 unresolved");
    expect(renderCheckOutput({ gate: "open", findings: [] }).title).toBe("Gate open");
    expect(renderCheckOutput({ gate: "error", findings: [] }).title).toBe("agentlint could not run");
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

describe("hostile and oversized content", () => {
  const FENCE = "`".repeat(3);
  const hostileText = `@everyone see <img src="https://tracker.example/p.png"> | x \`code\` [click](https://evil.example)\n# Heading`;

  it("clips annotation titles and messages to the GitHub limits", async () => {
    const [first] = await findings();
    if (!first) throw new Error("fixture");
    const [annotation] = renderAnnotations([
      {
        ...first,
        ruleTitle: "t".repeat(1_000),
        message: "m".repeat(100_000),
        guidance: { ...first.guidance, standard: "s".repeat(100_000) },
      },
    ]);
    if (!annotation) throw new Error("annotation");
    expect(annotation.title.length).toBeLessThanOrEqual(255);
    expect(annotation.title.endsWith("(truncated)")).toBe(true);
    expect(new TextEncoder().encode(annotation.message).length).toBeLessThan(64 * 1024);
    expect(annotation.message.endsWith("(truncated)")).toBe(true);
  });

  it("keeps finding text inert in the summary table", async () => {
    const [first] = await findings();
    if (!first) throw new Error("fixture");
    const summary = renderSummary({
      repository: "o/r",
      headSha: "a".repeat(40),
      pullNumber: 1,
      gate: "closed",
      findings: [{ ...first, ruleTitle: hostileText, message: hostileText, file: "src/we|rd`(x).ts" }],
      inlineDigests: new Set(),
    });
    expect(summary).not.toContain("<img");
    expect(summary).not.toContain("@everyone");
    expect(summary).not.toContain("[click](");
    expect(summary).not.toMatch(/^# Heading/m);
    expect(summary).toContain("&lt;img");
    expect(summary).toContain("/blob/" + "a".repeat(40) + "/src/we%7Crd%60%28x%29.ts#L3");
    // Every table row still has exactly the five unescaped column separators plus the two edges.
    const row = summary.split("\n").find((line) => line.startsWith("| @"));
    expect(row?.replace(/\\\|/g, "").split("|")).toHaveLength(7);
    expect(summary).toMatchSnapshot();
  });

  it("fences a diff that contains a fence, and keeps the rest of the body prose", async () => {
    const [first] = await findings();
    if (!first?.proposal) throw new Error("fixture");
    const diff = `+ok\n${FENCE}\n@everyone <img src=x>\n# not a heading\n${FENCE}\`\n+more`;
    const body = renderInlineBody({
      ...first,
      message: hostileText,
      guidance: { standard: hostileText, checks: [hostileText] },
      lineageReason: hostileText,
      proposal: { ...first.proposal, summary: hostileText, diff },
    });
    const opening = "`".repeat(5) + "diff";
    const start = body.indexOf(opening);
    const end = body.indexOf("\n" + "`".repeat(5) + "\n", start);
    expect(start).toBeGreaterThan(-1);
    expect(body.slice(start + opening.length + 1, end)).toBe(diff);
    const prose = body.slice(0, start) + body.slice(end);
    expect(prose).not.toContain("<img");
    expect(prose).not.toContain("@everyone");
    expect(prose).not.toContain("[click](");
    expect(body.endsWith('Reply "/agentlint approve <reason>" to accept.')).toBe(true);
    expect(body).toMatchSnapshot();
  });

  it("truncates a very long diff and very long text, and stays under the comment limit", async () => {
    const [first] = await findings();
    if (!first?.proposal) throw new Error("fixture");
    const long = "<@x|`>".repeat(20_000);
    const body = renderInlineBody({
      ...first,
      message: long,
      guidance: { standard: long, checks: Array.from({ length: 200 }, () => long) },
      lineageReason: long,
      proposal: { ...first.proposal, summary: long, diff: "+line\n".repeat(50_000) },
    });
    expect(body.length).toBeLessThan(BODY_BUDGET);
    expect(body).toMatch(/… diff truncated, \d+ more lines: open the review artifact/);
    expect(body).toContain("… and 180 more checks");
    expect(body.endsWith('Reply "/agentlint approve <reason>" to accept.')).toBe(true);
  });

  it("budgets the summary for 500 findings and says how many are not shown", async () => {
    const [first] = await findings();
    if (!first) throw new Error("fixture");
    const many = Array.from({ length: 500 }, (_, index) => ({
      ...first,
      digest: index.toString(16).padStart(64, "0"),
      file: `src/generated/some/deep/module-${index}.ts`,
      line: index + 1,
      message: "m".repeat(400),
    }));
    const summary = renderSummary({
      repository: "aurelienbobenrieth/agentlint",
      headSha: "a".repeat(40),
      pullNumber: 42,
      gate: "closed",
      findings: many,
      inlineDigests: new Set(),
    });
    expect(summary.length).toBeLessThanOrEqual(BODY_BUDGET);
    expect(summary).toContain("500 unresolved");
    const shown = summary.split("\n").filter((line) => line.startsWith("| ") && line.includes("/blob/")).length;
    expect(shown).toBeGreaterThan(50);
    expect(shown).toBeLessThan(500);
    expect(summary).toContain(`… and ${500 - shown} more findings — open the review artifact.`);
    expect(summary).toContain("agentlint pr 42");
    expect(headFromSummary(summary)).toBe("a".repeat(40));
  });

  it("fences CLI output that contains a fence", () => {
    const reply = renderFailureReply({
      heading: "agentlint could not record the approval:",
      output: `oops\n${FENCE}\n@everyone\n${"x".repeat(9_000)}`,
    });
    expect(reply.split("\n")[2]).toBe("`".repeat(4));
    expect(reply.length).toBeLessThan(6_000);
    expect(codeSpan("a`b")).toBe("`` a`b ``");
    expect(plain("a|b")).toBe("a\\|b");
    expect(fenced({ content: "x" })).toBe(`${FENCE}\nx\n${FENCE}`);
  });
});
