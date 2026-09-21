/** Source text normalization shared by every reader that feeds detection. @module @since 0.2.0 */

/**
 * Normalize line endings to `\n`. A checkout with `core.autocrlf` and one without must produce the
 * same evidence, so every source and dependency is normalized once, where it is read.
 */
export function normalizeLineEndings(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}
