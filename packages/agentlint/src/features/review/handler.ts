/**
 * Review session logic: payload assembly, action application, and the
 * feedback loop back to the agent.
 *
 * The review server is human-operated by definition — every action taken in
 * the UI is recorded with a `human:` actor. Rejections and change requests
 * are not ledger records: they land in `.agentlint/review-feedback.md`,
 * which the requesting agent reads after the session ends.
 *
 * @module
 * @since 0.2.0
 */

import { Effect, FileSystem, Path } from "effect";
import { userInfo } from "node:os";
import { Env } from "../../config/env.js";
import { normalizeConfig, policyForRule } from "../../domain/config.js";
import { normalizeGuidance } from "../../domain/guidance.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { ledgerKey, LedgerRecord, LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { buildReviewState } from "../../shared/pipeline/review-state.js";
import type {
  FindingStatus,
  ReviewAction,
  ReviewActionResult,
  ReviewFindingPayload,
  ReviewStatePayload,
} from "./contract.js";

const CONTEXT_RADIUS = 8;

function reviewActor(): string {
  try {
    return `human:${userInfo().username}/review-ui`;
  } catch {
    return "human:review-ui";
  }
}

function statusOf(disposition: { readonly status: string } | undefined): FindingStatus {
  if (!disposition) return "unresolved";
  switch (disposition.status) {
    case "accepted":
      return "accepted";
    case "approved":
      return "approved";
    case "deferred":
      return "deferred";
    case "no_fix":
      return "no_fix";
    case "approval_requested":
      return "pending_approval";
    default:
      return "unresolved";
  }
}

function contextAround(source: string, line: number): string {
  const lines = source.split("\n");
  const start = Math.max(0, line - 1 - CONTEXT_RADIUS);
  const end = Math.min(lines.length, line + CONTEXT_RADIUS);
  return lines
    .slice(start, end)
    .map((text, index) => `${String(start + index + 1).padStart(4)} | ${text}`)
    .join("\n");
}

/**
 * Assemble the full state payload for the review UI.
 *
 * @since 0.2.0
 */
export const buildReviewPayload = Effect.fn("buildReviewPayload")(function* (base: string | undefined) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configLoader = yield* ConfigLoader;

  const config = normalizeConfig(yield* configLoader.load());
  const state = yield* buildReviewState(base);

  const sources = new Map<string, string>();
  const findings: ReviewFindingPayload[] = [];
  for (const entry of state.findings) {
    const finding = entry.finding;
    let source = sources.get(finding.file);
    if (source === undefined) {
      source = yield* fs.readFileString(path.resolve(env.cwd, finding.file)).pipe(Effect.orElseSucceed(() => ""));
      sources.set(finding.file, source);
    }

    findings.push({
      hash: finding.hash,
      ruleId: finding.ruleId,
      file: finding.file,
      line: finding.line,
      column: finding.column,
      message: finding.message,
      snippet: finding.sourceSnippet,
      context: contextAround(source, finding.line),
      status: statusOf(entry.disposition),
      disposition: entry.disposition
        ? {
            status: entry.disposition.status,
            reason: entry.disposition.reason,
            actor: entry.disposition.actor,
            at: entry.disposition.at,
          }
        : null,
    });
  }

  const newIdentities = new Set(
    state.newRecords.map((record) => JSON.stringify([record.ruleId, record.hash, record.status, record.at])),
  );

  return {
    project: path.basename(env.cwd),
    base: state.base,
    generatedAt: new Date().toISOString(),
    rules: Object.values(config.rules)
      .map((rule) => {
        const guidance = normalizeGuidance(rule.guidance);
        const policy = policyForRule(config, rule.id);
        return {
          id: rule.id,
          description: rule.description,
          standard: guidance.standard,
          checks: guidance.checks,
          examples: guidance.examples,
          refs: guidance.refs,
          persistence: policy.persistence ?? "ephemeral",
          resolution: policy.resolution ?? "agent",
        };
      })
      .toSorted((a, b) => a.id.localeCompare(b.id)),
    findings,
    ledger: [...state.findings]
      .flatMap((entry) => (entry.disposition ? [entry.disposition] : []))
      .map((record) => ({
        ruleId: record.ruleId,
        hash: record.hash,
        status: record.status,
        reason: record.reason,
        actor: record.actor,
        at: record.at,
        isNew: newIdentities.has(JSON.stringify([record.ruleId, record.hash, record.status, record.at])),
      })),
    staleCount: state.staleRecords.length,
  } satisfies ReviewStatePayload;
});

/**
 * Feedback collected during a review session, returned to the agent.
 *
 * @since 0.2.0
 */
export interface ReviewFeedback {
  readonly ruleId: string;
  readonly hash: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly comment: string;
}

/**
 * Apply one review action. Ledger-affecting actions verify the finding
 * still exists at the recorded hash before writing.
 *
 * @since 0.2.0
 */
export const applyReviewAction = Effect.fn("applyReviewAction")(function* (
  action: ReviewAction,
  feedback: ReviewFeedback[],
) {
  const configLoader = yield* ConfigLoader;
  const ledgerStore = yield* LedgerStore;

  const config = normalizeConfig(yield* configLoader.load());
  const state = yield* buildReviewState(undefined);
  const entry = state.findings.find(
    (candidate) =>
      ledgerKey(candidate.finding.ruleId, candidate.finding.hash) === ledgerKey(action.ruleId, action.hash),
  );

  if (!entry) {
    return {
      ok: false,
      message: "Finding no longer exists at this hash - the code changed. Refresh the review.",
    } satisfies ReviewActionResult;
  }

  if (action.reason.trim().length === 0) {
    return { ok: false, message: "A reason is required." } satisfies ReviewActionResult;
  }

  if (action.type === "request_changes") {
    feedback.push({
      ruleId: action.ruleId,
      hash: action.hash,
      file: entry.finding.file,
      line: entry.finding.line,
      message: entry.finding.message,
      comment: action.reason.trim(),
    });
    return { ok: true, message: "Change request recorded for the agent." } satisfies ReviewActionResult;
  }

  const policy = policyForRule(config, action.ruleId);
  if (action.type === "accept" && policy.resolution === "human") {
    return {
      ok: false,
      message: `${action.ruleId} requires approval - use approve instead of accept.`,
    } satisfies ReviewActionResult;
  }

  const status =
    action.type === "approve"
      ? ("approved" as const)
      : action.type === "accept"
        ? ("accepted" as const)
        : action.type === "defer"
          ? ("deferred" as const)
          : ("no_fix" as const);

  yield* ledgerStore.append(
    new LedgerRecord({
      version: 1,
      persistence: policy.persistence === "durable" ? "durable" : undefined,
      ruleId: action.ruleId,
      hash: action.hash,
      status,
      reason: action.reason.trim(),
      actor: reviewActor(),
      at: new Date().toISOString(),
      summary: undefined,
      adr: undefined,
    }),
  );

  return { ok: true, message: `Recorded ${status}.` } satisfies ReviewActionResult;
});

/**
 * Write collected change requests to `.agentlint/review-feedback.md` so the
 * agent that requested the review can act on them.
 *
 * @since 0.2.0
 */
export const writeReviewFeedback = Effect.fn("writeReviewFeedback")(function* (
  feedback: ReadonlyArray<ReviewFeedback>,
) {
  if (feedback.length === 0) return null;

  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const lines: string[] = [
    "# Review feedback",
    "",
    `Recorded ${new Date().toISOString()} via agentlint review. Address each item, then delete this file and rerun agentlint check.`,
    "",
  ];
  for (const item of feedback) {
    lines.push(`## ${item.ruleId} - ${item.file}:${item.line}`);
    lines.push("");
    lines.push(`Finding: ${item.message}`);
    lines.push("");
    lines.push(item.comment);
    lines.push("");
  }

  const feedbackPath = path.resolve(env.cwd, ".agentlint", "review-feedback.md");
  yield* fs
    .makeDirectory(path.resolve(env.cwd, ".agentlint"), { recursive: true })
    .pipe(Effect.orElseSucceed(() => undefined));
  yield* fs.writeFileString(feedbackPath, lines.join("\n")).pipe(Effect.orElseSucceed(() => undefined));
  return ".agentlint/review-feedback.md";
});
