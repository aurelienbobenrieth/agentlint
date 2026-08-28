/**
 * Public rule authoring contracts.
 *
 * One rule composes a durable standard, an executable detector, and a
 * repository-owned binding. The lifecycle discriminator selects the detector
 * contract and the fixture shape.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";
import type { CanonicalValue } from "./fingerprint.js";
import type { AgentlintNode } from "./node.js";
import type { TreeSitterNodeType } from "./node-types.js";
import type { RuleContext } from "./rule-context.js";
import { Guidance } from "./guidance.js";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** @since 0.2.0 @category models */
export const SourceReference = Schema.Union([
  Schema.Struct({ type: Schema.Literal("url"), href: NonEmptyString }),
  Schema.Struct({ type: Schema.Literal("file"), path: NonEmptyString }),
]);
export type SourceReference = Schema.Schema.Type<typeof SourceReference>;

/** Durable review intent. Editorial changes do not require a new revision. */
export const RuleStandard = Schema.Struct({
  id: NonEmptyString,
  revision: PositiveInteger,
  title: NonEmptyString,
  summary: Schema.optional(NonEmptyString),
  guidance: Guidance,
  source: Schema.optional(SourceReference),
});
export type RuleStandard = Schema.Schema.Type<typeof RuleStandard>;

/** Structural constraint applied to a matched node's subtree. */
export const MatchWhere = Schema.Struct({
  has: Schema.optional(NonEmptyString),
  notHas: Schema.optional(NonEmptyString),
});
export type MatchWhere = Schema.Schema.Type<typeof MatchWhere>;

/** Declarative AST trigger. Exactly one of `pattern` and `query` is required. */
export const RuleMatch = Schema.Struct({
  pattern: Schema.optional(NonEmptyString),
  query: Schema.optional(NonEmptyString),
  where: Schema.optional(MatchWhere),
  message: NonEmptyString,
});
export type RuleMatch = Schema.Schema.Type<typeof RuleMatch>;

/** Callback invoked for a matching syntax node. */
export type VisitorHandler = (node: AgentlintNode) => void;

/** File lifecycle hooks of an imperative detector. `before` returns `false` to skip the file. */
export interface VisitorHooks {
  before?(path: string): boolean | void;
  after?(): void;
}

/** Imperative AST visitor escape hatch, keyed by grammar node type. */
export type Visitors = VisitorHooks & Partial<Record<TreeSitterNodeType, VisitorHandler>>;

/** One in-memory repository used by a detector fixture. */
export interface FixtureRepository {
  readonly files: Readonly<Record<string, string>>;
}

/** A state fixture can use one source file or a small repository. */
export type StateFixture =
  | string
  | {
      readonly label?: string | undefined;
      readonly file?: string | undefined;
      readonly source: string;
    }
  | ({ readonly label?: string | undefined } & FixtureRepository);

/** Detector examples prove activation and silence. They do not enumerate errors. */
export interface StateRuleFixtures {
  readonly mustReport?: ReadonlyArray<StateFixture> | undefined;
  readonly mustStaySilent?: ReadonlyArray<StateFixture> | undefined;
}

/** A normalized file snapshot. `content` is absent when the caller cannot load it. */
export const FileSnapshot = Schema.Struct({
  content: Schema.optional(Schema.String),
  digest: NonEmptyString,
});
export type FileSnapshot = Schema.Schema.Type<typeof FileSnapshot>;

/** One normalized diff line. The content excludes the diff marker. */
export const ChangeLine = Schema.Struct({
  kind: Schema.Literals(["context", "addition", "deletion"]),
  content: Schema.String,
});
export type ChangeLine = Schema.Schema.Type<typeof ChangeLine>;

/** One normalized diff hunk. Line numbers are one-based. */
export const ChangeHunk = Schema.Struct({
  oldStart: NonNegativeInteger,
  oldLines: NonNegativeInteger,
  newStart: NonNegativeInteger,
  newLines: NonNegativeInteger,
  lines: Schema.Array(ChangeLine),
});
export type ChangeHunk = Schema.Schema.Type<typeof ChangeHunk>;

/** One changed path between the selected baseline and working tree. */
export const ChangedFile = Schema.Struct({
  status: Schema.Literals(["added", "modified", "deleted", "renamed"]),
  path: NonEmptyString,
  previousPath: Schema.optional(NonEmptyString),
  before: Schema.NullOr(FileSnapshot),
  after: Schema.NullOr(FileSnapshot),
  hunks: Schema.Array(ChangeHunk),
});
export type ChangedFile = Schema.Schema.Type<typeof ChangedFile>;

/** Git comparison selected by the CLI or its caller. */
export const ChangeBaseline = Schema.Struct({
  kind: Schema.Literal("git"),
  ref: NonEmptyString,
  commit: Schema.optional(NonEmptyString),
});
export type ChangeBaseline = Schema.Schema.Type<typeof ChangeBaseline>;

/** Stable, platform-independent input for every change detector. */
export const ChangeSet = Schema.Struct({
  baseline: ChangeBaseline,
  files: Schema.Array(ChangedFile),
});
export type ChangeSet = Schema.Schema.Type<typeof ChangeSet>;

/** Change fixture with compact repositories or exact normalized evidence. */
export type ChangeFixture =
  | {
      readonly label?: string | undefined;
      readonly before?: Readonly<Record<string, string>> | undefined;
      readonly after?: Readonly<Record<string, string>> | undefined;
    }
  | {
      readonly label?: string | undefined;
      readonly change: ChangeSet;
    };

export interface ChangeRuleFixtures {
  readonly mustReport?: ReadonlyArray<ChangeFixture> | undefined;
  readonly mustStaySilent?: ReadonlyArray<ChangeFixture> | undefined;
}

/** Evidence reported by a change detector. `key` must be stable across line movement. */
export interface ChangeFindingOptions {
  /** Stable occurrence identity within this detector's normalized change. */
  readonly key: string;
  readonly file: string;
  readonly message: string;
  /** Detector-selected material judgment data used by the fingerprint. */
  readonly evidence: CanonicalValue;
  /** Optional broader identity that can surface prior reasoning after invalidation. */
  readonly lineageKey?: string | undefined;
  readonly excerpt?: string | undefined;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
}

export interface ChangeRuleContext {
  readonly change: ChangeSet;
  report(finding: ChangeFindingOptions): void;
}

/** Who may accept a finding produced by a binding. */
export const RuleAuthority = Schema.Literals(["agent", "human"]);
export type RuleAuthority = Schema.Schema.Type<typeof RuleAuthority>;

/** Which evidence a detector judges: current source or a normalized change. */
export const Lifecycle = Schema.Literals(["state", "change"]);
export type Lifecycle = Schema.Schema.Type<typeof Lifecycle>;

/** Repository-owned policy and material detector configuration. */
export interface RuleBinding<Options = unknown> {
  readonly id: string;
  readonly authority: RuleAuthority;
  readonly include?: ReadonlyArray<string> | undefined;
  readonly exclude?: ReadonlyArray<string> | undefined;
  readonly options?: Options | undefined;
}

interface DetectorIdentity {
  readonly id: string;
  readonly version: number;
}

export interface StateDetector<Options = unknown> extends DetectorIdentity {
  readonly match?: RuleMatch | ReadonlyArray<RuleMatch> | undefined;
  readonly createOnce?: ((context: RuleContext, options: Options) => Visitors) | undefined;
  readonly fixtures?: StateRuleFixtures | undefined;
}

export interface ChangeDetector<Options = unknown> extends DetectorIdentity {
  readonly detect: (context: ChangeRuleContext, options: Options) => void;
  readonly fixtures?: ChangeRuleFixtures | undefined;
}

interface RuleBase<Options> {
  readonly standard: RuleStandard;
  readonly binding: RuleBinding<Options>;
}

export interface StateRule<Options = unknown> extends RuleBase<Options> {
  readonly lifecycle: "state";
  readonly detector: StateDetector<Options>;
}

export interface ChangeRule<Options = unknown> extends RuleBase<Options> {
  readonly lifecycle: "change";
  readonly detector: ChangeDetector<Options>;
}

export type AgentlintRule<Options = unknown> = StateRule<Options> | ChangeRule<Options>;

/**
 * Raised by `defineRule` when a rule is structurally invalid.
 *
 * @since 0.2.0
 * @category errors
 */
export class RuleDefinitionError extends Schema.TaggedError<RuleDefinitionError>()("agentlint/RuleDefinitionError", {
  ruleId: Schema.String,
  reason: Schema.Literals([
    "empty_field",
    "invalid_detector_version",
    "ambiguous_match",
    "missing_state_implementation",
    "missing_change_detect",
  ]),
  field: Schema.optional(Schema.String),
}) {
  override get message(): string {
    switch (this.reason) {
      case "empty_field":
        return `Rule ${this.ruleId}: ${this.field} must not be empty`;
      case "invalid_detector_version":
        return `Rule ${this.ruleId}: detector version must be a positive integer`;
      case "ambiguous_match":
        return `Rule ${this.ruleId}: each match needs exactly one of "pattern" or "query"`;
      case "missing_state_implementation":
        return `Rule ${this.ruleId}: state detector must define "match" or "createOnce"`;
      case "missing_change_detect":
        return `Rule ${this.ruleId}: change detector must define "detect"`;
    }
  }
}

const StandardDecoder = Schema.decodeUnknownSync(RuleStandard);
const MatchDecoder = Schema.decodeUnknownSync(RuleMatch);
const AuthorityDecoder = Schema.decodeUnknownSync(RuleAuthority);

function assertNonEmpty(ruleId: string, value: string, field: string): void {
  if (value.trim().length === 0) throw new RuleDefinitionError({ ruleId, reason: "empty_field", field });
}

function validateCommon(rule: AgentlintRule): void {
  const ruleId = rule.binding.id;
  StandardDecoder(rule.standard);
  assertNonEmpty(ruleId, ruleId, "binding id");
  AuthorityDecoder(rule.binding.authority);
  assertNonEmpty(ruleId, rule.detector.id, "detector id");
  if (!Number.isSafeInteger(rule.detector.version) || rule.detector.version < 1) {
    throw new RuleDefinitionError({ ruleId, reason: "invalid_detector_version" });
  }
  for (const pattern of [...(rule.binding.include ?? []), ...(rule.binding.exclude ?? [])]) {
    assertNonEmpty(ruleId, pattern, "scope pattern");
  }
}

/**
 * Define one effective rule while preserving option and lifecycle inference.
 *
 * This is the only rule constructor. Narrow `rule.lifecycle` to access the
 * corresponding detector and fixture contract. Throws `RuleDefinitionError`
 * for structural mistakes.
 */
export function defineRule<const Options>(rule: StateRule<Options>): StateRule<Options>;
export function defineRule<const Options>(rule: ChangeRule<Options>): ChangeRule<Options>;
export function defineRule(rule: AgentlintRule): AgentlintRule {
  validateCommon(rule);
  const ruleId = rule.binding.id;
  if (rule.lifecycle === "state") {
    const matches = ruleMatches(rule);
    for (const match of matches) {
      MatchDecoder(match);
      if ((match.pattern === undefined) === (match.query === undefined)) {
        throw new RuleDefinitionError({ ruleId, reason: "ambiguous_match" });
      }
    }
    if (matches.length === 0 && !rule.detector.createOnce) {
      throw new RuleDefinitionError({ ruleId, reason: "missing_state_implementation" });
    }
  } else if (rule.lifecycle === "change") {
    if (typeof rule.detector.detect !== "function") {
      throw new RuleDefinitionError({ ruleId, reason: "missing_change_detect" });
    }
  }
  return rule;
}

/** Normalize the declarative matches of a state rule. Internal to the engine. */
export function ruleMatches(rule: StateRule): ReadonlyArray<RuleMatch> {
  const matches = rule.detector.match;
  if (!matches) return [];
  return Array.isArray(matches) ? matches : [matches as RuleMatch];
}
