/**
 * Versioned review SPA wire contract, shared with `apps/review` through the `@aurelienbbn/agentlint/contract` subpath.
 * Every value here is an Effect Schema over plain JSON so both sides decode the same shapes. This module must stay
 * browser-safe: it imports nothing but `effect`.
 *
 * @module @since 0.2.0
 */

import { Schema } from "effect";

export const ReviewMode = Schema.Literals(["calibration", "review"]);
export type ReviewMode = Schema.Schema.Type<typeof ReviewMode>;

export const ReviewTransport = Schema.Literals(["attached", "detached"]);
export type ReviewTransport = Schema.Schema.Type<typeof ReviewTransport>;

export const FindingStatus = Schema.Literals(["unresolved", "accepted", "changes_requested"]);
export type FindingStatus = Schema.Schema.Type<typeof FindingStatus>;

export const EditorApplicationId = Schema.Literals(["cursor", "vscode", "vscode-insiders", "zed", "explorer"]);
export type EditorApplicationId = Schema.Schema.Type<typeof EditorApplicationId>;

export const EditorApplication = Schema.Struct({ id: EditorApplicationId, label: Schema.String });
export type EditorApplication = Schema.Schema.Type<typeof EditorApplication>;

export const ReviewGuidance = Schema.Struct({
  summary: Schema.NullOr(Schema.String),
  standard: Schema.String,
  checks: Schema.Array(Schema.String),
  examples: Schema.Array(
    Schema.Struct({
      label: Schema.NullOr(Schema.String),
      description: Schema.NullOr(Schema.String),
      code: Schema.String,
    }),
  ),
  references: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["policy_url", "policy_file", "guidance_url", "agent_skill"]),
      label: Schema.String,
      target: Schema.String,
      /**
       * Browser-safe `http(s)` URL, or `null` when the target is a file, a skill, or an unsafe scheme.
       */
      href: Schema.NullOr(Schema.String),
    }),
  ),
});
export type ReviewGuidance = Schema.Schema.Type<typeof ReviewGuidance>;

export const ReviewAcceptance = Schema.Struct({
  authority: Schema.Literals(["agent", "human"]),
  reason: Schema.String,
  actor: Schema.String,
  at: Schema.String,
});
export type ReviewAcceptance = Schema.Schema.Type<typeof ReviewAcceptance>;

/**
 * Agent work recorded for this exact finding. Context for the decision; never opens the gate.
 */
export const ReviewProposal = Schema.Struct({
  summary: Schema.String,
  diff: Schema.NullOr(Schema.String),
  actor: Schema.String,
  at: Schema.String,
});
export type ReviewProposal = Schema.Schema.Type<typeof ReviewProposal>;

/**
 * Wire form of `FindingSource` from the domain.
 */
export const ReviewFindingSource = Schema.Struct({
  standardId: Schema.String,
  standardRevision: Schema.Number,
  detectorId: Schema.String,
  detectorVersion: Schema.Number,
  bindingId: Schema.String,
  bindingDigest: Schema.String,
});
export type ReviewFindingSource = Schema.Schema.Type<typeof ReviewFindingSource>;

/**
 * Wire form of `Fingerprint` from the domain.
 */
export const ReviewFingerprint = Schema.Struct({
  scheme: Schema.String,
  version: Schema.Number,
  digest: Schema.String,
});
export type ReviewFingerprint = Schema.Schema.Type<typeof ReviewFingerprint>;

/**
 * Everything a detached review needs to write an exact acceptance later.
 */
export const FindingIdentity = Schema.Struct({
  source: ReviewFindingSource,
  fingerprint: ReviewFingerprint,
  lineageKey: Schema.NullOr(Schema.String),
});
export type FindingIdentity = Schema.Schema.Type<typeof FindingIdentity>;

export const ReviewFindingPayload = Schema.Struct({
  id: Schema.String,
  identity: FindingIdentity,
  ruleId: Schema.String,
  ruleTitle: Schema.String,
  lifecycle: Schema.Literals(["state", "change"]),
  authority: Schema.Literals(["agent", "human"]),
  file: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  message: Schema.String,
  relatedFiles: Schema.Array(Schema.String),
  invalidationReasons: Schema.Array(Schema.String),
  /**
   * Present only when the live localhost session can safely resolve this finding in its repository.
   */
  editor: Schema.NullOr(Schema.Struct({ canOpen: Schema.Literal(true) })),
  code: Schema.Struct({
    /**
     * One-based source range. End coordinates follow the parser's exclusive end position.
     */
    focus: Schema.Struct({
      startLine: Schema.Number,
      startColumn: Schema.Number,
      endLine: Schema.Number,
      endColumn: Schema.Number,
    }),
  }),
  guidance: ReviewGuidance,
  status: FindingStatus,
  acceptance: Schema.NullOr(ReviewAcceptance),
  lineageReason: Schema.NullOr(Schema.String),
  proposal: Schema.NullOr(ReviewProposal),
});
export type ReviewFindingPayload = Schema.Schema.Type<typeof ReviewFindingPayload>;

export const CalibrationReason = Schema.Literals(["scope", "detector", "guidance", "valid_exception", "other"]);
export type CalibrationReason = Schema.Schema.Type<typeof CalibrationReason>;

export const ReviewCalibration = Schema.Literals(["applies", "does_not_apply", "unsure"]);
export type ReviewCalibration = Schema.Schema.Type<typeof ReviewCalibration>;

/**
 * Portable observations, separate from acceptance state. Reports never open a gate.
 */
export const CalibrationObservation = Schema.Struct({
  findingId: Schema.String,
  identity: FindingIdentity,
  ruleId: Schema.String,
  file: Schema.String,
  classification: ReviewCalibration,
  reason: Schema.NullOr(CalibrationReason),
  note: Schema.String,
  invalidationReasons: Schema.Array(Schema.String),
});
export type CalibrationObservation = Schema.Schema.Type<typeof CalibrationObservation>;

export const CalibrationReport = Schema.Struct({
  version: Schema.Literal(1),
  project: Schema.String,
  base: Schema.String,
  generatedAt: Schema.String,
  candidates: Schema.Array(Schema.Struct({ ruleId: Schema.String, count: Schema.Number })),
  observations: Schema.Array(CalibrationObservation),
});
export type CalibrationReport = Schema.Schema.Type<typeof CalibrationReport>;

export const ReviewStatePayload = Schema.Struct({
  version: Schema.Literal(3),
  sources: Schema.Record(Schema.String, Schema.String),
  coverage: Schema.Struct({
    scope: Schema.Literals(["partial", "complete"]),
    files: Schema.Array(Schema.String),
    rules: Schema.Array(Schema.String),
  }),
  mode: ReviewMode,
  transport: ReviewTransport,
  project: Schema.String,
  base: Schema.String,
  generatedAt: Schema.String,
  /**
   * Applications detected by the live localhost server. Always empty in detached artifacts.
   */
  applications: Schema.Array(EditorApplication),
  findings: Schema.Array(ReviewFindingPayload),
  calibration: Schema.Array(CalibrationObservation),
  detached: Schema.NullOr(
    Schema.Struct({
      source: Schema.String,
    }),
  ),
});
export type ReviewStatePayload = Schema.Schema.Type<typeof ReviewStatePayload>;

export const ReviewOpenRequest = Schema.Struct({
  findingId: Schema.String,
  application: EditorApplicationId,
});
export type ReviewOpenRequest = Schema.Schema.Type<typeof ReviewOpenRequest>;

/**
 * `POST /api/action` body. The `type` discriminant selects the fields the server reads.
 */
export const ReviewActionRequest = Schema.Union([
  Schema.Struct({ type: Schema.Literal("accept"), findingId: Schema.String, reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("request_changes"), findingId: Schema.String, reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("withdraw"), findingId: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("calibrate"),
    findingId: Schema.String,
    calibration: ReviewCalibration,
    reason: Schema.NullOr(CalibrationReason),
    note: Schema.String,
  }),
]);
export type ReviewActionRequest = Schema.Schema.Type<typeof ReviewActionRequest>;

export const ReviewActionResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.String,
});
export type ReviewActionResult = Schema.Schema.Type<typeof ReviewActionResult>;

export const ReviewFinishResult = Schema.Struct({
  ok: Schema.Boolean,
  summary: Schema.String,
  feedback: Schema.String,
});
export type ReviewFinishResult = Schema.Schema.Type<typeof ReviewFinishResult>;

/**
 * Detached artifact format written by `check --review-output` and read by `review --from`.
 */
export const ReviewArtifact = Schema.Struct({
  version: Schema.Literal(3),
  state: ReviewStatePayload,
});
export type ReviewArtifact = Schema.Schema.Type<typeof ReviewArtifact>;

/**
 * Server-session bookkeeping. Not sent over the wire.
 */
export interface ReviewFeedback {
  readonly findingId: string;
  readonly ruleId: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly comment: string;
}

export interface CalibrationFeedback {
  readonly findingId: string;
  readonly ruleId: string;
  readonly file: string;
  readonly classification: ReviewCalibration;
  readonly reason: CalibrationReason | null;
  readonly note: string;
}

export const NextResult = Schema.Struct({
  version: Schema.Literal(1),
  status: Schema.Literals(["unresolved", "clear", "no_matching_rules"]),
  scope: Schema.Literals(["partial", "complete"]),
  base: Schema.NullOr(Schema.String),
  remaining: Schema.Number,
  selector: Schema.NullOr(Schema.String),
  executedBindings: Schema.Array(Schema.String),
  finding: Schema.NullOr(ReviewFindingPayload),
  source: Schema.NullOr(Schema.String),
  excerpt: Schema.NullOr(Schema.String),
  actions: Schema.Array(
    Schema.Struct({
      purpose: Schema.String,
      argv: Schema.Array(Schema.String),
      requiredInput: Schema.NullOr(Schema.String),
    }),
  ),
  exitCode: Schema.Literals([0, 1, 2]),
});
export type NextResult = Schema.Schema.Type<typeof NextResult>;
