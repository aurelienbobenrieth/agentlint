import { describe, expect, it } from "vitest";

import { highlightedLine } from "./syntax";

describe("syntax highlighting", () => {
  it("highlights TypeScript and escapes source HTML", () => {
    const output = highlightedLine('const node: string = "<unsafe>";', "src/example.ts");

    expect(output).toContain("hljs-keyword");
    expect(output).toContain("hljs-built_in");
    expect(output).not.toContain("<unsafe>");
  });

  it("uses JSON grammar for JSON files", () => {
    expect(highlightedLine('{"enabled": true}', "settings.json")).toContain("hljs-attr");
  });
});
