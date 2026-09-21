import { describe, expect, it } from "vitest";
import { defineRule } from "./rule.js";
import { semanticStructure } from "./rule-context.js";
import { testRuleOnSource } from "../testing.js";

const danger = defineRule({
  lifecycle: "state",
  standard: { id: "review", revision: 1, title: "Review", guidance: "Verify authorization." },
  detector: { id: "danger", version: 1, match: { pattern: "danger($ARG)", message: "Review this call." } },
  binding: { id: "review", authority: "agent" },
});

const digestOf = async (source: string, file = "fixture.ts") => {
  const [finding] = await testRuleOnSource(danger, source, file);
  if (!finding) throw new Error(`Expected one finding in: ${source}`);
  return finding.fingerprint.digest;
};

/** The evidence captured for a whole file, read through a visitor on the grammar's root node. */
const structureOf = async (source: string, file: string, rootType: string) => {
  let structure: ReadonlyArray<string | number> | undefined;
  const rule = defineRule({
    ...danger,
    detector: {
      id: "structure",
      version: 1,
      scan: "file",
      createOnce: (context) => ({
        [rootType]: (node: Parameters<typeof semanticStructure>[0]) => {
          structure = semanticStructure(node, context.source);
        },
      }),
    },
  });
  await testRuleOnSource(rule, source, file);
  if (!structure) throw new Error(`No ${rootType} root in ${file}`);
  return structure;
};

describe("state evidence", () => {
  it("distinguishes source text that the grammar exposes as no node", async () => {
    expect(await digestOf("danger(x as `/public/${string}`)")).not.toBe(
      await digestOf("danger(x as `/admin/${string}`)"),
    );
    expect(await digestOf("danger(x as `a b${string}`)")).not.toBe(await digestOf("danger(x as `ab${string}`)"));
  });

  it("keeps the digest through a formatting-only change", async () => {
    expect(await digestOf("function run() { if (ok) danger(x as `/public/${string}`); }")).toBe(
      await digestOf("\nfunction run() {\n\tif (ok)\n    danger( x as `/public/${string}` );\n}\n"),
    );
  });

  it.each([
    ["template string", "fixture.ts", "program", "const a = `x ${y} z ${`n ${m}`} end`;"],
    ["template literal type", "fixture.ts", "program", "type Route = `/public/${string}/v${number}` | `é-𝒳-${Id}`;"],
    ["regex", "fixture.ts", "program", "const r = /a b\\/[c-d]+(?<n>x)/giu.test(s);"],
    ["JSX text", "fixture.tsx", "program", "const v = <p title='t'>Hello, {name} &amp; welcome <b>back</b> !</p>;"],
    ["comments", "fixture.ts", "program", "// line é\n/* block\n * 𝒳 */\nconst x = 1; /** doc */ function f() {}"],
    ["JavaScript", "fixture.js", "program", "#!/usr/bin/env node\nexport const f = async (a, b = `t${a}`) => a ?? b;"],
    ["JSON", "fixture.json", "document", '{ "a": [1, 2.5e3, "s \\" é", null, true], "b": { "c": "𝒳" } }'],
  ])("captures every non-whitespace character of a %s sample", async (_name, file, rootType, source) => {
    const captured = (await structureOf(source, file, rootType))
      .filter((entry, index, all) => typeof entry === "string" && typeof all[index + 1] !== "number")
      .join("");
    expect(captured.replace(/\s/g, "")).toBe(source.replace(/\s/g, ""));
  });
});

const digests = (findings: Awaited<ReturnType<typeof testRuleOnSource>>) =>
  findings.map((finding) => finding.fingerprint.digest).toSorted();

describe("structural position", () => {
  it("names the same occurrence whether the matcher, a query, or a visitor reports the node", async () => {
    const via = (detector: Parameters<typeof defineRule>[0]["detector"]) =>
      testRuleOnSource(defineRule({ ...danger, detector } as typeof danger), "a; { b(danger(1)); danger(2) }");
    const pattern = await via({ id: "danger", version: 1, match: { pattern: "danger($A)", message: "m" } });
    const query = await via({
      id: "danger",
      version: 1,
      match: { query: '(call_expression function: (identifier) @f (#eq? @f "danger")) @match', message: "m" },
    });
    const kept: Array<Parameters<typeof semanticStructure>[0]> = [];
    const visitor = await via({
      id: "danger",
      version: 1,
      scan: "file",
      createOnce: (context) => ({
        call_expression: (node) => {
          if (node.text.startsWith("danger(1")) kept.push(node);
          if (!node.text.startsWith("danger(2")) return;
          context.report({ node, message: "m" });
          // Reported after the walker has moved on: this position comes from climbing the tree.
          for (const earlier of kept) context.report({ node: earlier, message: "m" });
        },
      }),
    });
    expect(pattern).toHaveLength(2);
    expect(digests(query)).toEqual(digests(pattern));
    expect(digests(visitor)).toEqual(digests(pattern));
  });
});
