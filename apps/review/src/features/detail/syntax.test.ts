import { describe, expect, it } from "vitest";

import { highlightedLine, highlightedLines } from "./syntax";

describe("syntax highlighting", () => {
  it("highlights TypeScript and escapes source HTML", () => {
    const output = highlightedLine({ source: 'const node: string = "<unsafe>";', file: "src/example.ts" });

    expect(output).toContain("hljs-keyword");
    expect(output).toContain("hljs-built_in");
    expect(output).not.toContain("<unsafe>");
  });

  it("uses JSON grammar for JSON files", () => {
    expect(highlightedLine({ source: '{"enabled": true}', file: "settings.json" })).toContain("hljs-attr");
  });

  it("splits a whole file into balanced per-line fragments", () => {
    const source = "/* multi\nline */\nconst x = `a\nb`;\n";
    const lines = highlightedLines({ source, file: "src/example.ts" });

    expect(lines).toHaveLength(5);
    for (const line of lines) {
      const opened = line.match(/<span /gu)?.length ?? 0;
      const closed = line.match(/<\/span>/gu)?.length ?? 0;
      expect(closed).toBe(opened);
    }
    expect(lines[0]).toContain("hljs-comment");
    expect(lines[1]).toContain("hljs-comment");
    expect(highlightedLines({ source, file: "src/example.ts" })).toBe(lines);
  });

  it("keeps literal span markup in the source escaped and the fragments balanced", () => {
    const source =
      'const a = "</span>";\nconst b = `<span class="x">\n</span>`;\n// </span><span class="hljs-keyword">';
    const lines = highlightedLines({ source, file: "src/markup.ts" });

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).not.toContain('<span class="x">');
      const opened = line.match(/<span /gu)?.length ?? 0;
      const closed = line.match(/<\/span>/gu)?.length ?? 0;
      expect(closed).toBe(opened);
    }
    expect(lines.join("\n")).toContain("&lt;/span&gt;");
    expect(lines.join("\n")).toContain("&lt;span class=&quot;x&quot;&gt;");
  });
});
