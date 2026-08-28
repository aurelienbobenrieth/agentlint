/**
 * agentlint - deterministic triggers for contextual agent guidance.
 *
 * This is the public API surface. Everything a rule author or config author
 * needs is re-exported from here.
 *
 * @module
 * @since 0.2.0
 */

export { defineConfig, normalizeConfig } from "./domain/config.js";
export { defineRule, ruleId, ruleMatches } from "./domain/rule.js";
export { compactStandard, normalizeGuidance } from "./domain/guidance.js";

export type { AgentlintNode } from "./domain/node.js";
export { Position } from "./domain/node.js";
export type { AgentlintConfig, NormalizedConfig } from "./domain/config.js";
export type { FindingOptions } from "./domain/finding.js";
export { FindingRecord } from "./domain/finding.js";
export type { Guidance, GuidanceExample, GuidanceRef, NormalizedGuidance } from "./domain/guidance.js";
export type { TreeSitterNodeType } from "./domain/node-types.js";
export {
  ChangeBaseline,
  ChangedFile,
  ChangeHunk,
  ChangeLine,
  ChangeSet,
  FileSnapshot,
  MatchWhere,
  RuleAuthority,
  RuleMatch,
  RuleStandard,
  SourceReference,
} from "./domain/rule.js";
export type {
  AgentlintRule,
  ChangeDetector,
  ChangeFindingOptions,
  ChangeFixture,
  ChangeRule,
  ChangeRuleContext,
  ChangeRuleFixtures,
  FixtureRepository,
  RuleBinding,
  RuleGuidance,
  StateDetector,
  StateFixture,
  StateRule,
  StateRuleFixtures,
  VisitorHandler,
  Visitors,
} from "./domain/rule.js";
export type { RuleContext } from "./domain/rule-context.js";

// Testing utilities for rule and plugin authors.
export {
  normalizeChangeFixture,
  runRuleFixtures,
  runRuleOnChange,
  runRuleOnSource,
  runRuleOnSources,
} from "./shared/pipeline/rule-tester.js";
export { testRuleFixtures, testRuleOnChange, testRuleOnSource } from "./testing.js";
export type { FixtureFailure, FixtureReport, ReportedChangeFinding } from "./shared/pipeline/rule-tester.js";
export { PatternError } from "./shared/pipeline/pattern-match.js";
