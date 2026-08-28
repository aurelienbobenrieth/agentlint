import { Schema as S } from "effect";

export const FindingStatus = S.Literals(["unresolved", "accepted", "changes_requested"]);
export type FindingStatus = typeof FindingStatus.Type;

export const ReviewMode = S.Literals(["calibration", "review"]);
export type ReviewMode = typeof ReviewMode.Type;

export const ReviewTransport = S.Literals(["attached", "detached"]);
export type ReviewTransport = typeof ReviewTransport.Type;

export const EditorApplicationId = S.Literals(["cursor", "vscode", "vscode-insiders", "zed", "explorer"]);
export type EditorApplicationId = typeof EditorApplicationId.Type;

export const EditorApplication = S.Struct({ id: EditorApplicationId, label: S.String });

export const ReviewGuidance = S.Struct({
  summary: S.NullOr(S.String),
  standard: S.String,
  checks: S.Array(S.String),
  examples: S.Array(S.Struct({ label: S.NullOr(S.String), description: S.NullOr(S.String), code: S.String })),
  references: S.Array(
    S.Struct({
      kind: S.Literals(["policy_url", "policy_file", "guidance_url", "agent_skill"]),
      label: S.String,
      target: S.String,
      href: S.NullOr(S.String),
    }),
  ),
});

export const ReviewAcceptance = S.Struct({
  reason: S.String,
  actor: S.String,
  at: S.String,
});

export const FindingIdentity = S.Struct({
  source: S.Struct({
    standardId: S.String,
    standardRevision: S.Number,
    detectorId: S.String,
    detectorVersion: S.Number,
    bindingId: S.String,
    bindingDigest: S.String,
  }),
  fingerprint: S.Struct({
    scheme: S.String,
    version: S.Number,
    digest: S.String,
  }),
  lineageKey: S.NullOr(S.String),
});

export const ReviewFindingPayload = S.Struct({
  id: S.String,
  identity: FindingIdentity,
  ruleId: S.String,
  ruleTitle: S.String,
  lifecycle: S.Literals(["state", "change"]),
  authority: S.Literals(["agent", "human"]),
  file: S.String,
  line: S.Number,
  column: S.Number,
  message: S.String,
  editor: S.NullOr(S.Struct({ canOpen: S.Literal(true) })),
  code: S.Struct({
    source: S.String,
    focus: S.Struct({
      startLine: S.Number,
      startColumn: S.Number,
      endLine: S.Number,
      endColumn: S.Number,
    }),
  }),
  guidance: ReviewGuidance,
  status: FindingStatus,
  acceptance: S.NullOr(ReviewAcceptance),
  lineageReason: S.NullOr(S.String),
  proposal: S.NullOr(
    S.Struct({
      summary: S.String,
      diff: S.NullOr(S.String),
      actor: S.String,
      at: S.String,
    }),
  ),
});
export type ReviewFindingPayload = typeof ReviewFindingPayload.Type;

export const ReviewStatePayload = S.Struct({
  version: S.Literal(1),
  mode: ReviewMode,
  transport: ReviewTransport,
  project: S.String,
  base: S.String,
  generatedAt: S.String,
  applications: S.Array(EditorApplication),
  findings: S.Array(ReviewFindingPayload),
  detached: S.NullOr(
    S.Struct({
      source: S.String,
      canPersistAcceptances: S.Boolean,
    }),
  ),
});
export type ReviewStatePayload = typeof ReviewStatePayload.Type;

export type ReviewActionRequest =
  | Readonly<{ type: "accept"; findingId: string; reason: string }>
  | Readonly<{ type: "request_changes"; findingId: string; reason: string }>
  | Readonly<{ type: "withdraw"; findingId: string }>
  | Readonly<{
      type: "calibrate";
      findingId: string;
      calibration: "applies" | "does_not_apply" | "unsure";
      note: string;
    }>;

export interface ReviewFinishResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly feedback: string;
  readonly acceptanceOutput: string;
}
