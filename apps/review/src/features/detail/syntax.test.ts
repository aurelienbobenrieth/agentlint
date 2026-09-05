import { describe, expect, it } from "vitest";

import { highlightedLine, highlightedLines } from "./syntax";

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

  it("splits a whole file into balanced per-line fragments", () => {
    const source = "/* multi\nline */\nconst x = `a\nb`;\n";
    const lines = highlightedLines(source, "src/example.ts");

    expect(lines).toHaveLength(5);
    for (const line of lines) {
      const opened = line.match(/<span /gu)?.length ?? 0;
      const closed = line.match(/<\/span>/gu)?.length ?? 0;
      expect(closed).toBe(opened);
    }
    expect(lines[0]).toContain("hljs-comment");
    expect(lines[1]).toContain("hljs-comment");
    expect(highlightedLines(source, "src/example.ts")).toBe(lines);
  });
});
