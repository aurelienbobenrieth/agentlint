/**
 * agentlint — deterministic linting for AI agents.
 *
 * This is the public API surface. Everything a rule author or config author
 * needs is re-exported from here.
 *
 * ## Quick start
 *
 * ```ts
 * import { defineConfig, defineRule } from "agentlint"
 *
 * const myRule = defineRule({
 *   meta: {
 *     name: "my-rule",
 *     description: "Checks for something",
 *     languages: ["ts", "tsx"],
 *     instruction: "Evaluate whether ..."
 *   },
 *   createOnce(context) {
 *     return {
 *       comment(node) {
 *         context.flag({ node, message: "Found comment" })
 *       }
 *     }
 *   }
 * })
 *
 * export default defineConfig({
 *   include: ["src/**\/*.ts"],
 *   rules: { "my-rule": myRule }
 * })
 * ```
 *
 * @see {@link defineConfig} for config creation
 * @see {@link defineRule} for rule creation
 * @see {@link RuleContext} for the API available inside rules
 *
 * @module
 * @since 0.1.0
 */

export { defineConfig } from "./domain/config.js";
export { defineRule } from "./domain/rule.js";

export type { AgentReviewNode } from "./domain/node.js";
export { Position } from "./domain/node.js";
export type { AgentReviewConfig } from "./domain/config.js";
export type { FlagOptions } from "./domain/flag.js";
export { FlagRecord } from "./domain/flag.js";
export type { TreeSitterNodeType } from "./domain/node-types.js";
export { RuleMeta } from "./domain/rule.js";
export type { AgentReviewRule, VisitorHandler, Visitors } from "./domain/rule.js";
export type { RuleContext } from "./domain/rule-context.js";
