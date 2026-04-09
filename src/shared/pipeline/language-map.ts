/**
 * File extension → tree-sitter grammar mapping.
 *
 * Maps every supported file extension to the grammar name used by
 * the parser service. This is the single source of truth for which
 * file types agentlint can analyze.
 *
 * Uses Effect `HashMap` for an immutable, structurally-equal lookup table.
 *
 * @module
 * @since 0.1.0
 */

import { HashMap, Option } from "effect";

/**
 * Maps file extensions (without leading dot) to their tree-sitter
 * grammar name.
 *
 * @since 0.1.0
 * @category constants
 */
const EXTENSION_TO_GRAMMAR: HashMap.HashMap<string, string> = HashMap.make(
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
);

/**
 * Look up the tree-sitter grammar name for a file extension.
 *
 * Returns `undefined` for unsupported extensions — callers should
 * skip those files.
 *
 * @since 0.1.0
 * @category constructors
 */
export function grammarForExtension(ext: string): string | undefined {
  return Option.getOrUndefined(HashMap.get(EXTENSION_TO_GRAMMAR, ext));
}

/**
 * Return all file extensions that agentlint can parse.
 *
 * @since 0.1.0
 * @category constructors
 */
export function supportedExtensions(): ReadonlyArray<string> {
  return [...HashMap.keys(EXTENSION_TO_GRAMMAR)];
}
