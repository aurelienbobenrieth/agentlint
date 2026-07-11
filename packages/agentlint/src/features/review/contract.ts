/**
 * Review UI wire contract.
 *
 * JSON payloads exchanged between the local review server and the SPA.
 * `ui/src/types.ts` mirrors these types — keep both in sync.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";

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
  /** Numbered source lines around the finding. */
  readonly context: string;
  readonly status: FindingStatus;
  readonly disposition: {
    readonly status: string;
    readonly reason: string;
    readonly actor: string;
    readonly at: string;
    /** Whether this disposition is new relative to the base ref. */
    readonly isNew: boolean;
  } | null;
}

export interface ReviewLedgerRecordPayload {
  readonly ruleId: string;
  readonly hash: string;
  readonly status: string;
  readonly reason: string;
  readonly actor: string;
  readonly at: string;
  /** Whether this record is new relative to the base ref. */
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

export const ReviewAction = Schema.Struct({
  type: Schema.Literals(["approve", "accept", "defer", "no_fix", "request_changes"]),
  ruleId: Schema.String,
  hash: Schema.String,
  reason: Schema.String,
});

export type ReviewAction = Schema.Schema.Type<typeof ReviewAction>;

export interface ReviewActionResult {
  readonly ok: boolean;
  readonly message: string;
  readonly feedbackPath?: string | null;
}

export interface ReviewFinishResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly feedbackPath: string | null;
}
