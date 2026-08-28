import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("typescript", typescript);

const languageForFile = (file: string): "javascript" | "json" | "typescript" => {
  const extension = file.split(".").at(-1)?.toLocaleLowerCase();
  if (extension === "json") return "json";
  if (["js", "jsx", "mjs", "cjs"].includes(extension ?? "")) return "javascript";
  return "typescript";
};

/** Highlight one source line. highlight.js escapes source text before returning markup. */
export const highlightedLine = (source: string, file: string): string =>
  hljs.highlight(source.length === 0 ? " " : source, {
    language: languageForFile(file),
    ignoreIllegals: true,
  }).value;
