/**
 * Locale-independent ordering for persisted and gate-visible output. @module @since 0.2.0
 */

/**
 * Compare by UTF-16 code unit, so the order never depends on the host's ICU locale.
 */
export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
