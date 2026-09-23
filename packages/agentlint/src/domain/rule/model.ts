/**
 * Public rule authoring contracts.
 *
 * One rule composes a durable standard, an executable detector, and a repository-owned binding. The lifecycle
 * discriminator selects the detector contract and the fixture shape.
 *
 * @module
 * @since 0.2.0
 */

import { Predicate, Result, Schema } from "effect";
import { canonicalJson, repositoryPath, type CanonicalValue } from "../fingerprint.js";
import type { AgentlintNode } from "../node.js";
import type { TreeSitterNodeType } from "../node-types.js";
import { Guidance } from "../guidance.js";
import type { RuleContext } from "./context/model.js";
import { Lifecycle, RuleAuthority } from "./primitives.js";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * @since 0.2.0 @category models
 */
export const SourceReference = Schema.Union([
  Schema.Struct({ type: Schema.Literal("url"), href: NonEmptyString }),
  Schema.Struct({ type: Schema.Literal("file"), path: NonEmptyString }),
]);
export type SourceReference = Schema.Schema.Type<typeof SourceReference>;

/**
 * Durable review intent. Editorial changes do not require a new revision.
 */
export const RuleStandard = Schema.Struct({
  id: NonEmptyString,
  revision: PositiveInteger,
  title: NonEmptyString,
  summary: Schema.optional(NonEmptyString),
  guidance: Guidance,
  source: Schema.optional(SourceReference),
});
export type RuleStandard = Schema.Schema.Type<typeof RuleStandard>;

/**
 * Structural constraint applied to a matched node's subtree.
 */
export const MatchWhere = Schema.Struct({
  has: Schema.optional(NonEmptyString),
  notHas: Schema.optional(NonEmptyString),
});
export type MatchWhere = Schema.Schema.Type<typeof MatchWhere>;

/**
 * Declarative AST trigger. Exactly one of `pattern` and `query` is required.
 */
export const RuleMatch = Schema.Struct({
  pattern: Schema.optional(NonEmptyString),
  query: Schema.optional(NonEmptyString),
  where: Schema.optional(MatchWhere),
  message: NonEmptyString,
});
export type RuleMatch = Schema.Schema.Type<typeof RuleMatch>;

/**
 * Callback invoked for a matching syntax node.
 */
export type VisitorHandler = (node: AgentlintNode) => void;

/**
 * File lifecycle hooks of an imperative detector. `before` returns `false` to skip the file.
 */
export interface VisitorHooks {
  before?(path: string): boolean | void;
  after?(): void;
}

/**
 * Imperative AST visitor escape hatch, keyed by grammar node type.
 */
export type Visitors = VisitorHooks & Partial<Record<TreeSitterNodeType, VisitorHandler>>;

/**
 * One in-memory repository used by a detector fixture.
 */
export interface FixtureRepository {
  readonly files: Readonly<Record<string, string>>;
}

/**
 * A state fixture can use one source file or a small repository.
 */
export type StateFixture =
  | string
  | {
      readonly label?: string | undefined;
      readonly file?: string | undefined;
      readonly source: string;
    }
  | ({ readonly label?: string | undefined } & FixtureRepository);

/**
 * Detector examples prove activation and silence. They do not enumerate errors.
 */
export interface StateRuleFixtures {
  readonly mustReport?: ReadonlyArray<StateFixture> | undefined;
  readonly mustStaySilent?: ReadonlyArray<StateFixture> | undefined;
}

/**
 * A normalized file snapshot. `content` is absent when the caller cannot load it.
 */
export const FileSnapshot = Schema.Struct({
  content: Schema.optional(Schema.String),
  digest: NonEmptyString,
});
export type FileSnapshot = Schema.Schema.Type<typeof FileSnapshot>;

/**
 * One normalized diff line. The content excludes the diff marker.
 */
export const ChangeLine = Schema.Struct({
  kind: Schema.Literals(["context", "addition", "deletion"]),
  content: Schema.String,
});
export type ChangeLine = Schema.Schema.Type<typeof ChangeLine>;

/**
 * One normalized diff hunk. Line numbers are one-based.
 */
export const ChangeHunk = Schema.Struct({
  oldStart: NonNegativeInteger,
  oldLines: NonNegativeInteger,
  newStart: NonNegativeInteger,
  newLines: NonNegativeInteger,
  lines: Schema.Array(ChangeLine),
});
export type ChangeHunk = Schema.Schema.Type<typeof ChangeHunk>;

/**
 * One changed path between the selected baseline and working tree.
 */
export const ChangedFile = Schema.Struct({
  status: Schema.Literals(["added", "modified", "deleted", "renamed"]),
  path: NonEmptyString,
  previousPath: Schema.optional(NonEmptyString),
  before: Schema.NullOr(FileSnapshot),
  after: Schema.NullOr(FileSnapshot),
  hunks: Schema.Array(ChangeHunk),
});
export type ChangedFile = Schema.Schema.Type<typeof ChangedFile>;

/**
 * Git comparison selected by the CLI or its caller.
 */
export const ChangeBaseline = Schema.Struct({
  kind: Schema.Literal("git"),
  ref: NonEmptyString,
  commit: Schema.optional(NonEmptyString),
});
export type ChangeBaseline = Schema.Schema.Type<typeof ChangeBaseline>;

/**
 * Stable, platform-independent input for every change detector.
 */
export const ChangeSet = Schema.Struct({
  baseline: ChangeBaseline,
  files: Schema.Array(ChangedFile),
});
export type ChangeSet = Schema.Schema.Type<typeof ChangeSet>;

/**
 * Change fixture with compact repositories or exact normalized evidence.
 */
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

/**
 * Evidence reported by a change detector. `key` must be stable across line movement.
 */
export interface ChangeFindingOptions {
  /**
   * Stable occurrence identity within this detector's normalized change.
   */
  readonly key: string;
  readonly file: string;
  readonly message: string;
  /**
   * Detector-selected material judgment data used by the fingerprint.
   */
  readonly evidence: CanonicalValue;
  /**
   * Optional broader identity that can surface prior reasoning after invalidation.
   */
  readonly lineageKey?: string | undefined;
  readonly excerpt?: string | undefined;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
  /**
   * Other files in this normalized change that a reviewer should inspect with the primary finding.
   */
  readonly relatedFiles?: ReadonlyArray<string> | undefined;
}

export interface ChangeRuleContext {
  readonly change: ChangeSet;
  report(finding: ChangeFindingOptions): void;
}

/**
 * Who may accept a finding produced by a binding.
 */
export { Lifecycle, RuleAuthority } from "./primitives.js";

/**
 * Repository-owned policy and material detector configuration.
 */
export interface RuleBinding<Options extends CanonicalValue | undefined = CanonicalValue | undefined> {
  readonly id: string;
  readonly authority: RuleAuthority;
  /**
   * Repository-controlled review generation. Increment it to invalidate otherwise compatible acceptances without
   * consulting a clock. Omit when decisions expire only as their evidence changes.
   */
  readonly reviewEpoch?: number | undefined;
  readonly include?: ReadonlyArray<string> | undefined;
  readonly exclude?: ReadonlyArray<string> | undefined;
  readonly options?: Options | undefined;
  /**
   * State bindings only: exact repository-relative files supporting every decision.
   */
  readonly dependencies?: ReadonlyArray<string> | undefined;
}

interface DetectorIdentity {
  readonly id: string;
  readonly version: number;
}

export interface StateDetector<
  Options extends CanonicalValue | undefined = CanonicalValue | undefined,
> extends DetectorIdentity {
  readonly match?: RuleMatch | ReadonlyArray<RuleMatch> | undefined;
  createOnce?(input: { readonly context: RuleContext; readonly options: Options }): Visitors;
  /**
   * Imperative detectors default to repository scans. File-local visitors may opt into changed-file scans.
   */
  readonly scan?: "file" | "repository";
  readonly fixtures?: StateRuleFixtures | undefined;
}

export interface ChangeDetector<
  Options extends CanonicalValue | undefined = CanonicalValue | undefined,
> extends DetectorIdentity {
  detect(input: { readonly context: ChangeRuleContext; readonly options: Options }): void;
  readonly fixtures?: ChangeRuleFixtures | undefined;
}

interface RuleBase<Options extends CanonicalValue | undefined> {
  readonly standard: RuleStandard;
  readonly binding: RuleBinding<Options>;
}

export interface StateRule<
  Options extends CanonicalValue | undefined = CanonicalValue | undefined,
> extends RuleBase<Options> {
  readonly lifecycle: "state";
  readonly detector: StateDetector<Options>;
}

export interface ChangeRule<
  Options extends CanonicalValue | undefined = CanonicalValue | undefined,
> extends RuleBase<Options> {
  readonly binding: Omit<RuleBinding<Options>, "dependencies"> & { readonly dependencies?: never };
  readonly lifecycle: "change";
  readonly detector: ChangeDetector<Options>;
}

export type AgentlintRule<Options extends CanonicalValue | undefined = CanonicalValue | undefined> =
  | StateRule<Options>
  | ChangeRule<Options>;

/**
 * Raised by `defineRule` when a rule is structurally invalid.
 *
 * @since 0.2.0
 * @category Errors
 */
export class RuleDefinitionError extends Schema.TaggedError<RuleDefinitionError>()("agentlint/RuleDefinitionError", {
  ruleId: Schema.String,
  reason: Schema.Literals([
    "empty_field",
    "invalid_detector_version",
    "ambiguous_match",
    "missing_state_implementation",
    "missing_change_detect",
    "invalid_shape",
  ]),
  field: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return {
      invalid_shape: `Rule ${this.ruleId}: invalid rule shape${this.field ? ` (${this.field})` : ""}`,
      empty_field: `Rule ${this.ruleId}: ${this.field} must not be empty`,
      invalid_detector_version: `Rule ${this.ruleId}: detector version must be a positive integer`,
      ambiguous_match: `Rule ${this.ruleId}: each match needs exactly one of "pattern" or "query"`,
      missing_state_implementation: `Rule ${this.ruleId}: state detector must define "match" or "createOnce"`,
      missing_change_detect: `Rule ${this.ruleId}: change detector must define "detect"`,
    }[this.reason];
  }
}

/**
 * Raised when a detector breaks the engine contract: an invalid `context.report` call, or a hook that returns a
 * promise. The engine wraps it in a detection failure for the rule, so the gate stays closed.
 *
 * @since 0.2.0
 * @category Errors
 */
export class DetectorContractError extends Schema.TaggedError<DetectorContractError>()(
  "agentlint/DetectorContractError",
  {
    ruleId: Schema.String,
    reason: Schema.Literals([
      "invalid_path",
      "outside_change_set",
      "empty_key",
      "duplicate_key",
      "undeclared_related",
      "async_hook",
    ]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return {
      invalid_path: `Rule ${this.ruleId} reported an invalid repository path: ${this.detail}`,
      outside_change_set: `Rule ${this.ruleId} reported evidence outside the change set: ${this.detail}`,
      empty_key: `Rule ${this.ruleId} reported an empty finding key`,
      duplicate_key: `Rule ${this.ruleId} reported a duplicate finding key: ${this.detail}`,
      undeclared_related: `Rule ${this.ruleId} reported undeclared related context: ${this.detail}`,
      async_hook: `Rule ${this.ruleId} returned a promise from ${this.detail}; detectors must report synchronously`,
    }[this.reason];
  }
}

const MatchesShape = Schema.Union([RuleMatch, Schema.Array(RuleMatch)]);
const RuleShape = Schema.Struct({
  lifecycle: Lifecycle,
  standard: RuleStandard,
  binding: Schema.Struct({
    id: NonEmptyString,
    authority: RuleAuthority,
    reviewEpoch: Schema.optional(PositiveInteger),
    include: Schema.optional(Schema.Array(NonEmptyString)),
    exclude: Schema.optional(Schema.Array(NonEmptyString)),
    dependencies: Schema.optional(Schema.Array(NonEmptyString)),
    options: Schema.optional(Schema.Unknown),
  }),
  detector: Schema.Struct({
    id: NonEmptyString,
    version: Schema.Number,
    scan: Schema.optional(Schema.Literals(["file", "repository"])),
  }),
});

function assertNonEmpty({
  ruleId,
  value,
  field,
}: {
  readonly ruleId: string;
  readonly value: string;
  readonly field: string;
}): void {
  if (value.trim().length === 0) throw new RuleDefinitionError({ ruleId, reason: "empty_field", field });
}

function shapeError({ ruleId, field }: { readonly ruleId: string; readonly field: string }): RuleDefinitionError {
  return new RuleDefinitionError({ ruleId, reason: "invalid_shape", field });
}

function validateCommon(rule: AgentlintRule): void {
  const binding: unknown = Predicate.isObject(rule) ? Reflect.get(rule, "binding") : undefined;
  const bindingId: unknown = Predicate.isObject(binding) ? Reflect.get(binding, "id") : undefined;
  const shape = Schema.decodeUnknownResult(RuleShape)(rule);
  if (Result.isFailure(shape)) {
    throw shapeError({
      ruleId: Predicate.isString(bindingId) && bindingId ? bindingId : "unknown",
      field: shape.failure.message,
    });
  }
  const ruleId = rule.binding.id;
  const dependencies = Reflect.get(rule.binding, "dependencies");
  if (rule.lifecycle === "change" && dependencies !== undefined)
    throw shapeError({
      ruleId,
      field: "dependencies are for state bindings; change detectors report explicit evidence",
    });
  assertNonEmpty({ ruleId, value: ruleId, field: "binding id" });
  assertNonEmpty({ ruleId, value: rule.detector.id, field: "detector id" });
  if (!Number.isSafeInteger(rule.detector.version) || rule.detector.version < 1) {
    throw new RuleDefinitionError({ ruleId, reason: "invalid_detector_version" });
  }
  for (const pattern of [...(rule.binding.include ?? []), ...(rule.binding.exclude ?? [])]) {
    assertNonEmpty({ ruleId, value: pattern, field: "scope pattern" });
  }
  const options = canonicalJson(rule.binding.options ?? null);
  if (Result.isFailure(options)) throw shapeError({ ruleId, field: `options: ${options.failure.detail}` });
  for (const dependency of rule.binding.dependencies ?? []) {
    const normalized = repositoryPath(dependency);
    if (Result.isFailure(normalized)) throw shapeError({ ruleId, field: `dependencies: ${normalized.failure.detail}` });
    if (normalized.success !== dependency || /[*?[\]{}]/.test(dependency)) {
      throw shapeError({ ruleId, field: "dependencies must be exact normalized repository paths" });
    }
  }
}

/**
 * Define one effective rule while preserving option and lifecycle inference.
 *
 * This is the only rule constructor. Narrow `rule.lifecycle` to access the corresponding detector and fixture contract.
 * Throws `RuleDefinitionError` for structural mistakes.
 */
export function defineRule<const Options extends CanonicalValue | undefined>(
  rule: StateRule<Options>,
): StateRule<Options>;
export function defineRule<const Options extends CanonicalValue | undefined>(
  rule: ChangeRule<Options>,
): ChangeRule<Options>;
export function defineRule(rule: AgentlintRule): AgentlintRule;
export function defineRule(rule: AgentlintRule): AgentlintRule {
  validateCommon(rule);
  const ruleId = rule.binding.id;
  if (rule.lifecycle === "state") {
    const declared = Schema.decodeUnknownResult(MatchesShape)(rule.detector.match ?? []);
    if (Result.isFailure(declared)) throw shapeError({ ruleId, field: `match: ${declared.failure.message}` });
    const matches = ruleMatches(rule);
    for (const match of matches) {
      if ((match.pattern === undefined) === (match.query === undefined)) {
        throw new RuleDefinitionError({ ruleId, reason: "ambiguous_match" });
      }
    }
    if (
      (rule.detector.createOnce !== undefined && !Predicate.isFunction(Reflect.get(rule.detector, "createOnce"))) ||
      (matches.length === 0 && rule.detector.createOnce === undefined)
    ) {
      throw new RuleDefinitionError({ ruleId, reason: "missing_state_implementation" });
    }
  } else if (!Predicate.isFunction(Reflect.get(rule.detector, "detect"))) {
    throw new RuleDefinitionError({ ruleId, reason: "missing_change_detect" });
  }
  return rule;
}

/**
 * Normalize the declarative matches of a state rule. Internal to the engine.
 */
export function ruleMatches(rule: StateRule): ReadonlyArray<RuleMatch> {
  const matches = rule.detector.match;
  if (!matches) return [];
  return Schema.is(RuleMatch)(matches) ? [matches] : matches;
}
