import { describe, expect, it } from "vitest";
import { parseLiquidTree } from "./liquid-tree.js";
import { walkFile } from "../pipeline/tree-walker.js";
import type { AgentlintNode } from "../../domain/node.js";
import { wrapNode } from "../../domain/node.js";

const source = `<div class="price">
  {% if product.available %}
    <h1>{{ product.title }}</h1>
  {% endif %}
</div>
`;

describe("parseLiquidTree", () => {
  it("exposes the LiquidHTML AST through the tree-sitter surface", () => {
    const tree = parseLiquidTree(source);
    const root = wrapNode(tree.rootNode);

    expect(root.type).toBe("Document");
    const elements = root.descendantsOfType("HtmlElement");
    expect(elements.length).toBeGreaterThanOrEqual(2);
    const [div] = elements;
    expect(div?.text).toContain('<div class="price">');

    const tags = root.descendantsOfType("LiquidTag");
    expect(tags.map((tag) => tag.childByFieldName("markup") !== null || tag.text.includes("if"))).toContain(true);
  });

  it("reports accurate positions", () => {
    const tree = parseLiquidTree(source);
    const root = wrapNode(tree.rootNode);
    const h1 = root.descendantsOfType("HtmlElement").find((node) => node.text.startsWith("<h1"));
    expect(h1?.startPosition.row).toBe(2);
  });

  it("walks with the shared cursor-based walker", () => {
    const tree = parseLiquidTree(source);
    const seen: string[] = [];
    const context = {
      drainFindings: () => [],
    };
    walkFile(tree, [
      {
        ruleId: "test/liquid",
        context: context as never,
        visitors: {
          HtmlElement(node: AgentlintNode) {
            seen.push(node.text.split(">")[0] ?? "");
          },
          LiquidVariableOutput() {
            seen.push("output");
          },
        },
      },
    ]);

    expect(seen.some((entry) => entry.startsWith("<div"))).toBe(true);
    expect(seen).toContain("output");
  });

  it("throws on malformed liquid", () => {
    expect(() => parseLiquidTree("{% if a %}<div>{% endunless %}")).toThrow(/Attempting to close/u);
  });
});
