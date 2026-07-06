/**
 * Wire types for the review server API.
 *
 * Mirror of src/features/review/contract.ts - keep both in sync.
 */

export type FindingStatus = "unresolved" | "pending_approval" | "accepted" | "approved" | "deferred" | "no_fix";

export interface ReviewRulePayload {
  readonly id: string;
  readonly description: string;
  readonly standard: string;
  readonly checks: ReadonlyArray<string>;
  readonly examples: ReadonlyArray<{
    readonly label?: string | undefined;
    readonly bad?: string | undefined;
    readonly good?: string | undefined;
  }>;
  readonly refs: ReadonlyArray<
    { readonly type: "skill"; readonly id: string } | { readonly type: "url"; readonly href: string }
  >;
  readonly persistence: "ephemeral" | "durable";
  readonly resolution: "agent" | "human";
}

export interface ReviewFindingPayload {
  readonly hash: string;
  readonly ruleId: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly snippet: string;
  readonly context: string;
  readonly status: FindingStatus;
  readonly disposition: {
    readonly status: string;
    readonly reason: string;
    readonly actor: string;
    readonly at: string;
  } | null;
}

export interface ReviewLedgerRecordPayload {
  readonly ruleId: string;
  readonly hash: string;
  readonly status: string;
  readonly reason: string;
  readonly actor: string;
  readonly at: string;
  readonly isNew: boolean;
}

export interface ReviewStatePayload {
  readonly project: string;
  readonly base: string;
  readonly generatedAt: string;
  readonly rules: ReadonlyArray<ReviewRulePayload>;
  readonly findings: ReadonlyArray<ReviewFindingPayload>;
  readonly ledger: ReadonlyArray<ReviewLedgerRecordPayload>;
  readonly staleCount: number;
}

export type ReviewActionType = "approve" | "accept" | "defer" | "no_fix" | "request_changes";

export interface ReviewActionRequest {
  readonly type: ReviewActionType;
  readonly ruleId: string;
  readonly hash: string;
  readonly reason: string;
}

export interface ReviewActionResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface ReviewFinishResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly feedbackPath: string | null;
}
