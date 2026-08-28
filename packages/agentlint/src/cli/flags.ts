/** Pure helpers shared by the CLI flag definitions. @module @since 0.2.0 */

/**
 * Normalize repeated `--rule` values. Each occurrence may itself hold a
 * comma-separated list; the result is trimmed, empty entries removed, and
 * duplicates collapsed while keeping first-seen order.
 */
export function ruleIds(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    for (const part of value.split(",")) {
      const id = part.trim();
      if (id) seen.add(id);
    }
  }
  return [...seen];
}
