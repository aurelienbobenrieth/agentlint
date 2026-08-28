/** Versioned review SPA wire contract. @module @since 0.2.0 */

import { Schema } from "effect";
import type { AcceptanceRecord } from "../../domain/acceptance.js";
import type { Fingerprint, FindingSource } from "../../domain/fingerprint.js";

export type ReviewMode = "calibration" | "review";
export type ReviewTransport = "attached" | "detached";

export const EditorApplicationId = Schema.Literals(["cursor", "vscode", "vscode-insiders", "zed", "explorer"]);
export type EditorApplicationId = Schema.Schema.Type<typeof EditorApplicationId>;

export interface EditorApplication {
  readonly id: EditorApplicationId;
  readonly label: string;
}

export interface ReviewFindingPayload {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleTitle: string;
  readonly lifecycle: "state" | "change";
  readonly authority: "agent" | "human";
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  /** Present only when the live localhost session can safely resolve this finding in its repository. */
  readonly editor: { readonly canOpen: true } | null;
  readonly code: {
    /** Complete current file source when available. */
    readonly source: string;
    /** One-based source range. End coordinates follow the parser's exclusive end position. */
    readonly focus: {
      readonly startLine: number;
      readonly startColumn: number;
      readonly endLine: number;
      readonly endColumn: number;
    };
  };
  readonly guidance: {
    readonly summary: string | null;
    readonly standard: string;
    readonly checks: ReadonlyArray<string>;
    readonly examples: ReadonlyArray<{
      readonly label: string | null;
      readonly description: string | null;
      readonly code: string;
    }>;
    readonly references: ReadonlyArray<{
      readonly kind: "policy_url" | "policy_file" | "guidance_url" | "agent_skill";
      readonly label: string;
      readonly target: string;
      readonly href: string | null;
    }>;
  };
  readonly status: "unresolved" | "accepted" | "changes_requested";
  readonly acceptance: {
    readonly reason: string;
    readonly actor: string;
    readonly at: string;
  } | null;
  readonly lineageReason: string | null;
  /** Agent work recorded for this exact finding. Context for the decision; never opens the gate. */
  readonly proposal: {
    readonly summary: string;
    readonly diff: string | null;
    readonly actor: string;
    readonly at: string;
  } | null;
  readonly identity: {
    readonly source: FindingSource;
    readonly fingerprint: Fingerprint;
    readonly lineageKey: string | null;
  };
}

export interface ReviewStatePayload {
  readonly version: 1;
  readonly mode: ReviewMode;
  readonly transport: ReviewTransport;
  readonly project: string;
  readonly base: string;
  readonly generatedAt: string;
  /** Applications detected by the live localhost server. Always empty in detached artifacts. */
  readonly applications: ReadonlyArray<EditorApplication>;
  readonly findings: ReadonlyArray<ReviewFindingPayload>;
  readonly detached: {
    readonly source: string;
    readonly canPersistAcceptances: boolean;
  } | null;
}

export const ReviewOpenRequest = Schema.Struct({
  findingId: Schema.String,
  application: EditorApplicationId,
});
export type ReviewOpenRequest = Schema.Schema.Type<typeof ReviewOpenRequest>;

export const ReviewAction = Schema.Struct({
  type: Schema.Literals(["accept", "request_changes", "withdraw", "calibrate"]),
  findingId: Schema.String,
  reason: Schema.optional(Schema.String),
  calibration: Schema.optional(Schema.Literals(["applies", "does_not_apply", "unsure"])),
  note: Schema.optional(Schema.String),
});
export type ReviewAction = Schema.Schema.Type<typeof ReviewAction>;

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
  readonly classification: "applies" | "does_not_apply" | "unsure";
  readonly note: string;
}

export interface ReviewActionResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface ReviewFinishResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly feedback: string;
  readonly acceptanceOutput: string;
}

/** Detached artifact format written by the CLI. */
export interface ReviewArtifact {
  readonly version: 1;
  readonly state: ReviewStatePayload;
  readonly acceptances?: ReadonlyArray<AcceptanceRecord> | undefined;
}
