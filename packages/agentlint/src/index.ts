/**
 * agentlint - deterministic triggers for contextual agent guidance.
 *
 * This is the public API surface for rule and config authors. Testing
 * helpers live in `@aurelienbbn/agentlint/testing`.
 *
 * @module
 * @since 0.2.0
 */

export { defineConfig, ConfigError } from "./domain/config.js";
export { defineRule, RuleDefinitionError } from "./domain/rule.js";
export { PatternError } from "./shared/pipeline/pattern-match.js";
export { ParserError } from "./shared/infrastructure/parser.js";

// Runtime schemas a consumer may need to construct or decode.
export { FindingRecord, findingId } from "./domain/finding.js";
export { ChangeBaseline, ChangedFile, ChangeHunk, ChangeLine, ChangeSet, FileSnapshot } from "./domain/rule.js";

export type { AgentlintConfig } from "./domain/config.js";
export type { AgentlintNode, Position } from "./domain/node.js";
export type { TreeSitterNodeType } from "./domain/node-types.js";
export type { Guidance, GuidanceExample, GuidanceRef } from "./domain/guidance.js";
export type { RuleContext } from "./domain/rule-context.js";
export type {
  AgentlintRule,
  ChangeDetector,
  ChangeFindingOptions,
  ChangeFixture,
  ChangeRule,
  ChangeRuleContext,
  ChangeRuleFixtures,
  FixtureRepository,
  Lifecycle,
  MatchWhere,
  RuleAuthority,
  RuleBinding,
  RuleMatch,
  RuleStandard,
  SourceReference,
  StateDetector,
  StateFixture,
  StateRule,
  StateRuleFixtures,
  VisitorHandler,
  VisitorHooks,
  Visitors,
} from "./domain/rule.js";

export type { CanonicalValue, CanonicalObject } from "./domain/fingerprint.js";
export type { FindingOptions } from "./domain/finding.js";
