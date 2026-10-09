import { describe, expect, it } from "vitest";
import { defineRule } from "../../domain/rule/model.js";
import { testRuleFixtures, testRuleOnSource } from "../../testing.js";

const source = `import { danger } from "./helper";
export function Card(props: { value: number }) @{
  const result = danger(() => props.value);
  <>
    @if (danger() > 0) { <div>{danger()}</div> }
    @for (const item of [danger()]) { <span>{item}{danger()}</span> }
  </>
}`;
const rule = defineRule({
  lifecycle: "state",
  standard: { id: "test/danger", revision: 1, title: "Danger", guidance: "Review danger" },
  detector: {
    id: "test/danger",
    version: 1,
    match: { pattern: "danger($$$ARGS)", message: "Review danger" },
    fixtures: {
      mustReport: [{ file: "Card.tsrx", source }],
      mustStaySilent: [{ file: "Card.tsrx", source: source.replaceAll("danger", "safe") }],
    },
  },
  binding: { id: "test/danger", authority: "agent" },
});
const scan = (text = source) => testRuleOnSource({ rule, source: text, file: "Card.tsrx", tsrx: "octane" });
const genericQueryRule = (query: string) =>
  defineRule({
    ...rule,
    detector: { id: "test/generic-query", version: 1, match: { query, message: "Generic parameters" } },
  });

describe("authored Octane state scanning", () => {
  it("exposes native template comments without synthetic JSX semantics", async () => {
    const text = `export function Card() @{
  <div>
    // danger() is a comment
    <span>{danger()}</span>
    /* danger() is also a comment */
    <p>danger text</p>
  </div>
}`;
    expect(await scan(text)).toHaveLength(1);
    const comments = await testRuleOnSource({
      rule: genericQueryRule("(comment) @match"),
      source: text,
      file: "Card.tsrx",
      tsrx: "octane",
    });
    expect(comments.map((hit) => [hit.line, hit.column, hit.sourceSnippet])).toEqual([
      [3, 5, "// danger() is a comment"],
      [5, 5, "/* danger() is also a comment */"],
    ]);
    expect(
      await testRuleOnSource({
        rule: genericQueryRule("(jsx_expression (comment) @match)"),
        source: text,
        file: "Card.tsrx",
        tsrx: "octane",
      }),
    ).toEqual([]);
    const renderedText = defineRule({
      ...rule,
      detector: {
        id: "test/rendered-text",
        version: 1,
        createOnce({ context }) {
          return {
            jsx_text(node) {
              if (node.text.includes("danger")) context.report({ node, message: "Rendered text" });
            },
          };
        },
      },
    });
    const rendered = await testRuleOnSource({ rule: renderedText, source: text, file: "Card.tsrx", tsrx: "octane" });
    expect(rendered.map((hit) => hit.sourceSnippet)).toEqual(["danger text"]);
    const first = await scan(text);
    expect((await scan("\n" + text.replaceAll("  ", "    "))).map((hit) => hit.fingerprint)).toEqual(
      first.map((hit) => hit.fingerprint),
    );
    expect((await scan(text.replace("is a comment", "is changed evidence"))).map((hit) => hit.fingerprint)).not.toEqual(
      first.map((hit) => hit.fingerprint),
    );
    expect(await scan(text)).toEqual(first);
  });
  it.each([
    {
      name: "compiler IfStatement alternates in multi-branch template chains",
      text: `export function Card(props: { icon: string }) @{
  @if (danger() === "sparkles") { <div>{danger()}</div> }
  @else if (danger() === "pen") { <span>{danger()}</span> }
  @else if (props.icon === "image") { <p>{danger()}</p> }
  @else { <i>{danger()}</i> }
}`,
      count: 6,
    },
    {
      name: "typed destructured and generic component parameters",
      text: `export function Card<V extends string>({ item, actions }: {
  item: V; actions: () => void
}) @{
  <button onClick={() => danger(item)}>{danger(actions)}</button>
}`,
      count: 2,
    },
    {
      name: "typed array, defaulted and rest component parameters",
      text: `export function Card([item]: readonly string[], value = danger(), ...rest: string[]) @{
  <div>{danger(item, value, rest)}</div>
}`,
      count: 2,
    },
    {
      name: "line and block comments between authored template children",
      text: `export function Card() @{
  <div>
    // Octane treats this as a comment, not rendered text: danger()
    <span>{danger()}</span>
    /* Another comment: danger() */
    @if (true) { <p>{danger()}</p> }
  </div>
}`,
      count: 2,
    },
    {
      name: "statement-only component bodies with null render",
      text: `export function Card() @{
  const state = danger();
  return state.match({ Ready: () => <div>{danger()}</div> });
}`,
      count: 2,
    },
    {
      name: "validated empty component bodies and template branches",
      text: `export function Empty() @{}
export function Card() @{ @if (true) {} @else if (false) {} @else {} }`,
      count: 0,
    },
  ])("scans $name at authored positions with activation and silence", async ({ text, count }) => {
    const hits = await scan(text);
    expect(hits).toHaveLength(count);
    for (const hit of hits) {
      expect(text.split("\n")[hit.line - 1]?.slice(hit.column - 1)).toMatch(/^danger\(/);
      expect(hit.sourceSnippet).toMatch(/^danger\(/);
    }
    expect(await scan(text.replaceAll("danger", "safe"))).toEqual([]);
    expect(await scan(text)).toEqual(hits);
  });

  it("preserves template branch structure through compiler IfStatement alternates", async () => {
    const text = `export function Card() @{
  @if (danger()) { <div/> } @else if (danger()) { <span/> } @else { <p/> }
}`;
    const branches = defineRule({
      ...rule,
      detector: {
        id: "test/branches",
        version: 1,
        createOnce({ context }) {
          return {
            octane_if_statement(node) {
              const test = node.childByFieldName("test");
              const consequent = node.childByFieldName("consequent");
              const alternate = node.childByFieldName("alternate");
              if (
                test?.text === "danger()" &&
                consequent?.type === "octane_block_statement" &&
                alternate?.type === "octane_block_statement"
              )
                context.report({ node, message: "Authored template alternate" });
            },
          };
        },
      },
    });
    const hits = await testRuleOnSource({ rule: branches, source: text, file: "Card.tsrx", tsrx: "octane" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sourceSnippet).toMatch(/^if \(danger\(\)\)/);
  });

  it("runs activation/silence fixtures and reports every authored call at original positions", async () => {
    expect(await testRuleFixtures(rule, { tsrx: "octane" })).toMatchObject({ total: 2, failures: [] });
    const hits = await scan();
    expect(hits).toHaveLength(5);
    for (const hit of hits) {
      expect(hit.file).toBe("Card.tsrx");
      const line = source.split("\n")[hit.line - 1];
      expect(line?.slice(hit.column - 1)).toMatch(/^danger\(/);
      expect(hit.sourceSnippet).toMatch(/^danger\(/);
    }
    expect(await scan()).toEqual(hits);
  });
  it("keeps formatting evidence stable and invalidates changed authored code", async () => {
    const first = await scan();
    const formatted = await scan("\n" + source.replaceAll("  ", "    "));
    expect(formatted.map((hit) => hit.fingerprint)).toEqual(first.map((hit) => hit.fingerprint));
    const changed = await scan(source.replace("props.value", "props.value + 1"));
    expect(changed.map((hit) => hit.fingerprint)).not.toEqual(first.map((hit) => hit.fingerprint));
  });
  it("never scans compiler-generated helpers", async () => {
    const helperRule = defineRule({
      ...rule,
      detector: {
        id: "test/helpers",
        version: 1,
        match: { pattern: "__map_iterable($$$ARGS)", message: "Generated helper" },
      },
    });
    expect(await testRuleOnSource({ rule: helperRule, source, file: "Card.tsrx", tsrx: "octane" })).toEqual([]);
  });
  it("visits components and imports in the authored tree", async () => {
    const componentRule = defineRule({
      ...rule,
      detector: {
        id: "test/components",
        version: 1,
        fixtures: {
          mustReport: [{ file: "Card.tsrx", source }],
          mustStaySilent: [{ file: "plain.tsrx", source: "const value = 1;" }],
        },
        createOnce({ context }) {
          return {
            octane_function_declaration(node) {
              context.report({ node, message: "Component" });
            },
            import_statement(node) {
              context.report({ node, message: "Import" });
            },
          };
        },
      },
    });
    expect((await testRuleFixtures(componentRule, { tsrx: "octane" })).failures).toEqual([]);
    const hits = await testRuleOnSource({ rule: componentRule, source, file: "Card.tsrx", tsrx: "octane" });
    expect(hits.map((hit) => hit.message)).toEqual(["Import", "Component"]);
    expect(hits[1]?.line).toBe(2);
    expect(hits[1]?.sourceSnippet).toMatch(/^function Card/);
  });
  it.each([
    "export function Broken() @{ <div>{danger(}</div> }",
    "export function Broken() @{ @if(true) { <div/> } @for(const x of []) { <span/> } }",
    "export function Unsupported() @{ <style>div { color: red }</style> <div/> }",
  ])("refuses malformed or unsupported source: %s", async (text) => {
    await expect(scan(text)).rejects.toThrow(/Octane frontend failed/);
  });
  it("requires explicit opt-in even when the compiler is installed", async () => {
    await expect(testRuleOnSource({ rule, source, file: "Card.tsrx" })).rejects.toThrow(/tsrx: "octane"/);
  });
});

it("scans the real frozen workspace-search pair, not renamed TSX", async () => {
  const { readFileSync } = await import("node:fs");
  const before = readFileSync(new URL("../../__fixtures__/octane/documents-before.tsrx", import.meta.url), "utf8");
  const after = readFileSync(new URL("../../__fixtures__/octane/documents-after.tsrx", import.meta.url), "utf8");
  const workspace = defineRule({
    ...rule,
    detector: {
      id: "test/workspace",
      version: 1,
      match: { pattern: "useLinkedState(query, $INITIAL)", message: "Workspace invalidation" },
    },
  });
  const scanWorkspace = (text: string) =>
    testRuleOnSource({
      rule: workspace,
      source: text,
      file: "apps/web/src/features/documents/documents-home.tsrx",
      tsrx: "octane",
    });
  const hits = await scanWorkspace(before);
  expect(hits.map((hit) => [hit.line, hit.column])).toEqual([
    [54, 28],
    [55, 28],
  ]);
  expect(await scanWorkspace(before)).toEqual(hits);
  expect(await scanWorkspace(after)).toEqual([]);
});

it("preserves authored unicode offsets and typed callback structure", async () => {
  const text = `// 🦉 authored unicode before the component
export function Unicode() @{
  const state = danger((value: string): string => value);
  <div title="🦉">{state}</div>
}`;
  const hits = await testRuleOnSource({ rule, source: text, file: "Unicode.tsrx", tsrx: "octane" });
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ line: 3, column: 17, endLine: 3, endColumn: 57 });
});

it("keeps the published anonymous-operator limitation visible and qualifies explicit queries", async () => {
  const pattern = defineRule({
    ...rule,
    detector: {
      id: "test/operator-pattern",
      version: 1,
      match: { pattern: "$SCOPES.every(($$$PARAMS) => $LEFT === $RIGHT)", message: "Equality" },
    },
  });
  const query = defineRule({
    ...rule,
    detector: {
      id: "test/operator-query",
      version: 1,
      match: {
        query:
          '((call_expression function: (member_expression property: (property_identifier) @method) arguments: (arguments (arrow_function body: (binary_expression operator: "===")))) @match (#eq? @method "every"))',
        message: "Equality",
      },
    },
  });
  const equality = "export function Test() @{ const x = scopes.every((value) => value === pinned); <div>{x}</div> }";
  const bound = equality.replace("===", "<=");
  await Promise.all(
    (
      [
        ["fixture.tsx", undefined],
        ["fixture.tsrx", "octane"],
      ] as const
    ).map(async ([file, tsrx]) => {
      const authored = (text: string) =>
        tsrx ? text : text.replace("@{", "{").replace("<div>{x}</div>", "return <div>{x}</div>");
      expect(
        await testRuleOnSource({ rule: pattern, source: authored(bound), file, ...(tsrx ? { tsrx } : {}) }),
      ).toHaveLength(1);
      expect(
        await testRuleOnSource({ rule: query, source: authored(equality), file, ...(tsrx ? { tsrx } : {}) }),
      ).toHaveLength(1);
      expect(await testRuleOnSource({ rule: query, source: authored(bound), file, ...(tsrx ? { tsrx } : {}) })).toEqual(
        [],
      );
    }),
  );
});

it("rejects query captures of synthetic parse-context wrappers", async () => {
  const query = defineRule({
    ...rule,
    detector: { id: "test/wrapper-query", version: 1, match: { query: "(program) @match", message: "Whole program" } },
  });
  await expect(testRuleOnSource({ rule: query, source, file: "Card.tsrx", tsrx: "octane" })).rejects.toThrow(
    /region boundary|region wrapper/,
  );
});

it("keeps generic parameter queries authored and refuses synthetic declaration relationships", async () => {
  const text = "export function Card<V extends string>(props: { value: V }) @{ <div>{props.value}</div> }";
  const hits = await testRuleOnSource({
    rule: genericQueryRule("(type_parameters) @match"),
    source: text,
    file: "Card.tsrx",
    tsrx: "octane",
  });
  expect(hits).toHaveLength(1);
  expect(hits[0]?.sourceSnippet).toBe("<V extends string>");
  await expect(
    testRuleOnSource({
      rule: genericQueryRule("(function_declaration type_parameters: (type_parameters) @match)"),
      source: text,
      file: "Card.tsrx",
      tsrx: "octane",
    }),
  ).rejects.toThrow(/synthetic parse-context/);
});

it("refuses query meaning created by an expression-statement parse wrapper", async () => {
  const query = defineRule({
    ...rule,
    detector: {
      id: "test/statement-query",
      version: 1,
      match: { query: "(expression_statement (call_expression) @match)", message: "Standalone call" },
    },
  });
  const text = "export function Card() @{ @if (danger()) { <div/> } }";
  await expect(testRuleOnSource({ rule: query, source: text, file: "Card.tsrx", tsrx: "octane" })).rejects.toThrow(
    /synthetic parse-context/,
  );
});

it("invalidates accepted evidence for authored template text, operators, and loop keys", async () => {
  const text = `export function Card() @{ const state = danger(); <> @if (state > 0) { <div>Original</div> } @for (const item of rows; key item.id) { <span>{item.id}</span> } </> }`;
  const original = await scan(text);
  const variants = [
    text.replace("Original", "Changed"),
    text.replace("state > 0", "state >= 0"),
    text.replace("key item.id", "key item.name"),
  ];
  const changed = await Promise.all(variants.map((variant) => scan(variant)));
  for (const findings of changed) {
    expect(findings).toHaveLength(1);
    expect(findings[0]?.fingerprint).not.toEqual(original[0]?.fingerprint);
  }
});
