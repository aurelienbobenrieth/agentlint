/**
 * FNV-1a hashing utility.
 *
 * Produces a 7-character hex digest used for stable, deterministic
 * flag identification. The hash encodes rule name, file path, position,
 * and message so that identical matches across runs share the same id.
 *
 * @see https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
 *
 * @module
 * @since 0.1.0
 */

/**
 * FNV-1a 32-bit offset basis.
 *
 * @since 0.1.0
 * @category constants
 */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/**
 * FNV-1a 32-bit prime multiplier.
 *
 * @since 0.1.0
 * @category constants
 */
const FNV_PRIME = 0x01000193;

/**
 * Compute a 7-character hex FNV-1a hash of `input`.
 *
 * The result is the first 7 hex characters of the unsigned 32-bit
 * FNV-1a digest — short enough for display, long enough to avoid
 * collisions in typical lint runs.
 *
 * @example
 * ```ts
 * import { fnv1a7 } from "./utils/hash.js"
 *
 * fnv1a7("my-rule:src/index.ts:10:1:message") // => "a3f4b2c"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export function fnv1a7(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}
