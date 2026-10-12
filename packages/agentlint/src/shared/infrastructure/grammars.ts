/**
 * The grammar builds agentlint parses with. Shared with the build, which packages each one as
 * `tree-sitter-<name>.wasm`.
 *
 * Each TypeScript flavour ships two builds, since each rejects valid code the other parses. The 0.20 builds in
 * tree-sitter-wasms read `<!--` at the start of a regex as an HTML comment and reject `&` in a JSX string attribute;
 * tree-sitter-typescript 0.23.2 rejects a tagged template with an object type argument (`` sql<{ id: string }>`…` ``).
 *
 * @module
 */

/**
 * Where each grammar's `.wasm` lives, relative to `node_modules`.
 */
export const GRAMMAR_SOURCES: Readonly<Record<string, string>> = {
  typescript: "tree-sitter-wasms/out/tree-sitter-typescript.wasm",
  "typescript-0.23": "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  "tsx-0.20": "tree-sitter-wasms/out/tree-sitter-tsx.wasm",
  javascript: "tree-sitter-wasms/out/tree-sitter-javascript.wasm",
  json: "tree-sitter-wasms/out/tree-sitter-json.wasm",
};

/**
 * The build that parses a file its grammar rejects. A file parsed today keeps its tree, so its fingerprints hold.
 */
export const GRAMMAR_FALLBACKS: Readonly<Record<string, string>> = {
  typescript: "typescript-0.23",
  tsx: "tsx-0.20",
};

/**
 * The file a grammar is packaged as.
 */
export const packagedGrammarFile = (grammar: string): string => `tree-sitter-${grammar}.wasm`;
