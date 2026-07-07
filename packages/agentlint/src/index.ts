/**
 * agentlint - deterministic triggers for contextual agent guidance.
 *
 * This is the public API surface. Everything a rule author or config author
 * needs is re-exported from here.
 *
 * @module
 * @since 0.2.0
 */

export { defineConfig, definePreset, normalizeConfig, policyForRule } from "./domain/config.js";
export { defineRule } from "./domain/rule.js";
export { compactStandard, normalizeGuidance } from "./domain/guidance.js";
export { boundedQuery, queryStateCoverage } from "./rules/index.js";
export { basePreset, frontendPreset } from "./rules/presets.js";

export type { AgentlintNode } from "./domain/node.js";
export { Position } from "./domain/node.js";
export type {
  AgentlintConfig,
  ConfigOverride,
  NormalizedConfig,
  Persistence,
  Resolution,
  RulePolicy,
  RuleSwitch,
} from "./domain/config.js";
export type { FindingOptions } from "./domain/finding.js";
export { FindingRecord } from "./domain/finding.js";
export type { Guidance, GuidanceExample, GuidanceRef, NormalizedGuidance } from "./domain/guidance.js";
export type { TreeSitterNodeType } from "./domain/node-types.js";
export { RuleDefinition, ruleMatches } from "./domain/rule.js";
export type {
  AgentlintRule,
  MatchWhere,
  RuleFixtures,
  RuleGuidance,
  RuleMatch,
  VisitorHandler,
  Visitors,
} from "./domain/rule.js";
export type { RuleContext } from "./domain/rule-context.js";

// Testing utilities for rule and plugin authors.
export { runRuleFixtures, runRuleOnSource } from "./shared/pipeline/rule-tester.js";
export { testRuleFixtures, testRuleOnSource } from "./testing.js";
export type { FixtureFailure, FixtureReport } from "./shared/pipeline/rule-tester.js";
export { PatternError } from "./shared/pipeline/pattern-match.js";
