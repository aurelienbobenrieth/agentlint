import { describe, expect, it } from "vitest";
import { defineRule, type StateRule } from "../model.js";
import { testRuleOnSource } from "../../../testing.js";

/**
 * Reports every `danger(...)` call: a finding whose identity covers the whole file's structure.
 */
const rule = defineRule({
  lifecycle: "state",
  standard: { id: "review/danger", revision: 1, title: "Danger is reviewed", guidance: "Review each danger call." },
  detector: {
    id: "review/danger-call",
    version: 1,
    createOnce: ({ context }) => ({
      call_expression(node) {
        if (node.childByFieldName("function")?.text === "danger")
          context.report({ node, message: "Review this call." });
      },
    }),
  },
  binding: { id: "review/danger", authority: "agent" },
}) as StateRule;

const identities = async (source: string, file = "fixture.tsx") =>
  (await testRuleOnSource({ rule, source, file })).map((finding) => ({
    fingerprint: finding.fingerprint,
    lineageKey: finding.lineageKey,
  }));

/**
 * What oxfmt or Prettier write for one program at different settings. Every spelling in a row must fingerprint alike.
 */
const formatted: ReadonlyArray<readonly [label: string, ...variants: string[]]> = [
  [
    "print width and trailing commas",
    'export const run = (items: Item[]) => danger(items, { limit: 10, cursor: "a" }, "x");\n',
    'export const run = (items: Item[]) =>\n  danger(\n    items,\n    {\n      limit: 10,\n      cursor: "a",\n    },\n    "x",\n  );\n',
    'export const run = (items: Item[]) =>\n  danger(items, { limit: 10, cursor: "a" }, "x")\n',
  ],
  [
    "quote style and escapes",
    "danger(\"it's\", 'x');\n",
    "danger('it\\'s', \"x\");\n",
    'danger("it\\u0027s", "\\x78");\n',
  ],
  ["semicolons", "const a = 1;\ndanger(a);\n", "const a = 1\ndanger(a)\n"],
  [
    "redundant parentheses and arrow parameter parentheses",
    "const f = (x) => (x ? danger(x) : null);\n",
    "const f = x => x ? danger(x) : null;\n",
    "const f = ((x) => ((x) ? (danger(x)) : null));\n",
  ],
  ["a union's leading pipe", 'type T = "a" | "b";\ndanger(1);\n', 'type T =\n  | "a"\n  | "b";\ndanger(1);\n'],
  [
    "JSX line breaks, parentheses, and explicit spaces",
    'const view = <p className="a">hello <b>{danger(1)}</b> world</p>;\n',
    "const view = (\n  <p className='a'>\n    hello{\" \"}\n    <b>{danger(1)}</b> world\n  </p>\n);\n",
  ],
  [
    "comment layout",
    "/** Runs the danger call. */\ndanger(1); // done\n",
    "/**\n * Runs the danger\n * call.\n */\ndanger(1); //   done\n",
  ],
  ["number spelling", "danger(1.50, 0XFF, .5, 1E3);\n", "danger(1.5, 0xff, 0.5, 1e3);\n"],
  ["quoted property names", 'danger({ "a": 1, b: 2 });\n', "danger({ a: 1, b: 2 });\n"],
  ["new without arguments", "const x = new Foo;\ndanger(x);\n", "const x = new Foo();\ndanger(x);\n"],
  [
    "member separators",
    "interface I { a: string, b: number }\ndanger(1);\n",
    "interface I {\n  a: string;\n  b: number;\n}\ndanger(1);\n",
  ],
  [
    "import wrapping and blank lines",
    'import { a, b, c } from "m";\ndanger(a);\n',
    "import {\n  a,\n  b,\n  c,\n} from 'm';\n\n\ndanger(a);\n",
  ],
  ["parentheses around the reported call", "const y = (danger(1));\n", "const y = danger(1);\n"],
];

/**
 * Edits a formatter never makes: each must give the finding a new identity.
 */
const semantic: ReadonlyArray<readonly [label: string, before: string, after: string]> = [
  [
    "a renamed identifier",
    "const limit = 10;\nif (limit > 0) danger(items, limit);\n",
    "const max = 10;\nif (max > 0) danger(items, max);\n",
  ],
  ["a changed literal", "const limit = 10;\ndanger(items, limit);\n", "const limit = 11;\ndanger(items, limit);\n"],
  ["an added argument", "danger(items, limit);\n", "danger(items, limit, true);\n"],
  ["a removed guard", "if (limit > 0) danger(items, limit);\n", "danger(items, limit);\n"],
  ["a changed operator", "if (limit > 0) danger(items, limit);\n", "if (limit >= 0) danger(items, limit);\n"],
  ["a changed grouping", "danger((a + b) * c);\n", "danger(a + b * c);\n"],
  ["an array hole", "danger([a, , b]);\n", "danger([a, b]);\n"],
  ["an optional chain cut short", "danger((a?.b).c);\n", "danger(a?.b.c);\n"],
  ["an escape that changes the value", 'danger("\\n");\n', 'danger("\\\\n");\n'],
  ["JSX text", "const v = <p>a b{danger(1)}</p>;\n", "const v = <p>ab{danger(1)}</p>;\n"],
  ["a typed arrow parameter", "const f = (x: Item) => danger(x);\n", "const f = x => danger(x);\n"],
  ["a legacy octal literal", "danger(017);\n", "danger(17);\n"],
];

describe("source-structure v4", () => {
  it.each(formatted)("keeps one identity across %s", async (_label, ...variants) => {
    const [first, ...rest] = await Promise.all(variants.map((variant) => identities(variant)));
    expect(first).toHaveLength(1);
    for (const other of rest) expect(other).toEqual(first);
  });

  it.each(semantic)("gives %s a new identity", async (_label, before, after) => {
    const [left, right] = await Promise.all([identities(before), identities(after)]);
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
    expect(right[0]?.fingerprint).not.toEqual(left[0]?.fingerprint);
  });

  it("keeps one identity across randomly combined formatting choices", async () => {
    // A fixed-seed linear congruential generator: the same 40 programs on every run.
    const state = { seed: 20_261_001 };
    const pick = () => {
      state.seed = (state.seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return state.seed / 2 ** 31 < 0.5;
    };
    const program = () => {
      const q = pick() ? "'" : '"';
      const comma = () => (pick() ? "," : "");
      const semi = () => (pick() ? ";" : "");
      const space = () => (pick() ? "\n  " : " ");
      const key = pick() ? `${q}limit${q}` : "limit";
      const parameter = pick() ? "(x)" : "x";
      const call = `danger(${space()}x,${space()}{ ${key}: 1_0 }${comma()}${space()})`;
      const body = pick() ? `(${call})` : call;
      const union = pick() ? `\n  | ${q}a${q}\n  | ${q}b${q}` : ` ${q}a${q} | ${q}b${q}`;
      return [
        `import {${space()}a,${space()}b${comma()}${space()}} from ${q}m${q}${semi()}`,
        pick() ? "\n" : "",
        `export const run = ${parameter} =>${space()}${body}${semi()}`,
        `type T =${union}${semi()}`,
        "",
      ].join("\n");
    };
    const programs = Array.from({ length: 40 }, program);
    expect(new Set(programs).size).toBeGreaterThan(30);
    const [first, ...rest] = await Promise.all(programs.map((source) => identities(source, "fixture.ts")));
    expect(first).toHaveLength(1);
    for (const [index, other] of rest.entries())
      expect([programs[index + 1], other]).toEqual([programs[index + 1], first]);
  });
});
