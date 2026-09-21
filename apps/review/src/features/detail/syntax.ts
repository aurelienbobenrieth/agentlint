import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("typescript", typescript);

type Language = "javascript" | "json" | "typescript";

const languageForFile = (file: string): Language => {
  const extension = file.split(".").at(-1)?.toLocaleLowerCase();
  if (extension === "json") return "json";
  if (["js", "jsx", "mjs", "cjs"].includes(extension ?? "")) return "javascript";
  return "typescript";
};

const highlight = (source: string, language: Language): string =>
  hljs.highlight(source.length === 0 ? " " : source, { language, ignoreIllegals: true }).value;

const LINE_CACHE_LIMIT = 4_000;
const lineCache = new Map<string, string>();

/**
 * Highlight one source line. highlight.js escapes source text before returning markup. Cached per language and line
 * text: diffs and examples repeat the same lines across renders.
 */
export const highlightedLine = (source: string, file: string): string => {
  const language = languageForFile(file);
  const key = `${language}\u0000${source}`;
  const cached = lineCache.get(key);
  if (cached !== undefined) return cached;
  if (lineCache.size >= LINE_CACHE_LIMIT) lineCache.clear();
  const value = highlight(source, language);
  lineCache.set(key, value);
  return value;
};

const SPAN_TOKEN = /<span class="[^"]*">|<\/span>/gu;

/**
 * Split highlighted markup by line, re-opening the spans a multi-line token (comment, template literal) leaves open so
 * every line is a self-contained fragment.
 */
const splitHighlighted = (markup: string): ReadonlyArray<string> => {
  const open: string[] = [];
  return markup.split("\n").map((line) => {
    const prefix = open.join("");
    for (const token of line.matchAll(SPAN_TOKEN)) {
      if (token[0] === "</span>") open.pop();
      else open.push(token[0]);
    }
    return `${prefix}${line}${"</span>".repeat(open.length)}`;
  });
};

const SNIPPET_CACHE_LIMIT = 64;
const snippetCache = new Map<string, ReadonlyArray<string>>();

/**
 * Highlight a whole snippet once and split it by line. Whole-snippet highlighting keeps multi-line tokens correct, and
 * the cache makes the focused/full toggle and re-renders free. Keyed by language and text so a finding's source and its
 * guidance examples never evict each other.
 */
export const highlightedLines = (source: string, file: string): ReadonlyArray<string> => {
  const language = languageForFile(file);
  const key = `${language} ${source}`;
  const cached = snippetCache.get(key);
  if (cached !== undefined) return cached;
  if (snippetCache.size >= SNIPPET_CACHE_LIMIT) snippetCache.clear();
  const lines = splitHighlighted(highlight(source, language));
  snippetCache.set(key, lines);
  return lines;
};
