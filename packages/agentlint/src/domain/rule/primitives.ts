/**
 * Small rule value contracts shared by rules and findings.
 *
 * Keeping these schemas independent prevents the finding model from importing the complete rule-authoring graph.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";

/**
 * Who may accept a finding produced by a binding.
 */
export const RuleAuthority = Schema.Literals(["agent", "human"]);
export type RuleAuthority = Schema.Schema.Type<typeof RuleAuthority>;

/**
 * Which evidence a detector judges: current source or a normalized change.
 */
export const Lifecycle = Schema.Literals(["state", "change"]);
export type Lifecycle = Schema.Schema.Type<typeof Lifecycle>;
