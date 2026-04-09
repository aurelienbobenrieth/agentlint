/**
 * Configuration types and the `defineConfig` helper.
 *
 * A config file (`agentlint.config.ts`) default-exports an {@link AgentReviewConfig}
 * object that maps rule names to rule definitions and optionally scopes which
 * files are scanned.
 *
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";
import type { AgentReviewRule } from "./rule.js";
import { RuleMeta } from "./rule.js";

/**
 * Top-level configuration schema for `agentlint.config.ts`.
 *
 * @since 0.1.0
 * @category models
 */
export interface AgentReviewConfig {
  /** Rule registry. Keys are kebab-case names used in output and `--rule` filtering. */
  readonly rules: Record<string, AgentReviewRule>;
  /** If provided, only files matching at least one pattern are scanned. */
  readonly include?: ReadonlyArray<string> | undefined;
  /** Files matching any pattern are excluded (merged with built-in defaults). */
  readonly ignore?: ReadonlyArray<string> | undefined;
}

/**
 * Identity function that provides type inference and IDE support for config files.
 *
 * @example
 * ```ts
 * import { defineConfig } from "agentlint"
 *
 * export default defineConfig({
 *   include: ["src/**\/*.ts"],
 *   rules: { "my-rule": myRule }
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export function defineConfig(config: AgentReviewConfig): AgentReviewConfig {
  for (const rule of Object.values(config.rules)) {
    Schema.decodeUnknownSync(RuleMeta)(rule.meta);
  }
  return config;
}
