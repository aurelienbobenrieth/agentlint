/**
 * Review payload and action application. @module @since 0.2.0
 */

import { Clock, Effect, Path } from "effect";
import type { CheckResult } from "../check/request.js";
import { acceptanceKey, lookupAcceptance } from "../../domain/acceptance.js";
import { Env } from "../../config/env.js";
import { findLineage, invalidationReasons } from "../../domain/acceptance.js";
import { findingKey } from "../../domain/finding.js";
import { normalizeGuidance } from "../../domain/guidance.js";
import { findProposal } from "../../domain/proposal.js";
import { acceptFinding } from "../accept/handler.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { ProposalStore } from "../../shared/infrastructure/proposal-store.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import type {
  CalibrationFeedback,
  EditorApplication,
  ReviewActionRequest,
  ReviewActionResult,
  ReviewFeedback,
  ReviewFindingPayload,
  ReviewMode,
  ReviewStatePayload,
  ReviewTransport,
} from "./contract.js";

export interface ReviewSessionState {
  readonly feedback: ReviewFeedback[];
  readonly calibration: CalibrationFeedback[];
  readonly requested: Set<string>;
  /**
   * The stored decision last served to this session for each finding, or `null` when none was stored. A revocation is
   * compared against it, so a decision recorded elsewhere after the page rendered survives.
   */
  readonly served: Map<string, { readonly acceptedAt: string; readonly reason: string } | null>;
}

const browserHref = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * True when `target` is `directory` or below it. Both paths must already be absolute.
 */
export function isInsideDirectory(path: Path.Path, directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return relative !== ".." && !relative.startsWith("../") && !relative.startsWith("..\\") && !path.isAbsolute(relative);
}

export function makeReviewSessionState(): ReviewSessionState {
  return { feedback: [], calibration: [], requested: new Set(), served: new Map() };
}

export interface BuildReviewPayloadOptions {
  readonly check?: CheckResult;
  readonly rules?: ReadonlyArray<string> | undefined;
  readonly files?: ReadonlyArray<string> | undefined;
  readonly base?: string | undefined;
  readonly mode: ReviewMode;
  readonly transport: ReviewTransport;
  readonly source?: string | undefined;
  readonly session?: ReviewSessionState | undefined;
  readonly applications?: ReadonlyArray<EditorApplication> | undefined;
}

export const buildReviewPayload = Effect.fn("buildReviewPayload")(function* (options: BuildReviewPayloadOptions) {
  const env = yield* Env;
  const path = yield* Path.Path;
  const config = yield* (yield* ConfigLoader).load();
  const snapshot = options.check
    ? {
        records: options.check.acceptances,
        byKey: new Map(options.check.acceptances.map((record) => [acceptanceKey(record), record])),
      }
    : yield* (yield* AcceptanceStore).read();
  const proposals = yield* (yield* ProposalStore).read();
  const collection =
    options.check ??
    (yield* collectFindings({
      all: true,
      rules: [...(options.rules ?? [])],
      base: options.base ?? config.base,
      files: [...(options.files ?? [])],
    }));
  const findings: ReviewFindingPayload[] = [];

  for (const finding of collection.findings) {
    const rule = config.rulesById.get(finding.ruleId);
    // Findings come from this configuration. Skipping one would show a clear queue for unreviewed work.
    if (!rule) return yield* Effect.die(new Error(`Finding ${finding.ruleId} has no rule in the loaded configuration`));
    const id = findingKey(finding);
    const acceptance = lookupAcceptance(snapshot, finding);
    const stored = snapshot.byKey.get(id);
    options.session?.served.set(id, stored ? { acceptedAt: stored.acceptedAt, reason: stored.reason } : null);
    const lineage = findLineage(snapshot.records, finding);
    const reasons = lineage ? invalidationReasons(lineage, finding) : [];
    const proposal = findProposal(proposals, finding);
    const absoluteFile = path.resolve(env.cwd, finding.file);
    const isInsideRepository = isInsideDirectory(path, env.cwd, absoluteFile);
    const guidance = normalizeGuidance(rule.standard.guidance);
    const references: ReviewFindingPayload["guidance"]["references"][number][] = [];
    if (rule.standard.source) {
      references.push(
        rule.standard.source.type === "url"
          ? {
              kind: "policy_url",
              label: "Why this rule exists",
              target: rule.standard.source.href,
              href: browserHref(rule.standard.source.href),
            }
          : {
              kind: "policy_file",
              label: "Why this rule exists",
              target: rule.standard.source.path,
              href: null,
            },
      );
    }
    for (const ref of guidance.refs) {
      references.push(
        ref.type === "url"
          ? { kind: "guidance_url", label: "Further reading", target: ref.href, href: browserHref(ref.href) }
          : { kind: "agent_skill", label: "Agent skill", target: ref.id, href: null },
      );
    }

    findings.push({
      id,
      ruleId: finding.ruleId,
      ruleTitle: rule.standard.title,
      lifecycle: finding.lifecycle,
      authority: finding.authority,
      file: finding.file,
      line: finding.line,
      column: finding.column,
      message: finding.message,
      relatedFiles: [
        ...new Set([finding.file, ...(rule.lifecycle === "state" ? (rule.binding.dependencies ?? []) : [])]),
      ].toSorted(),
      invalidationReasons: [...reasons],
      editor: options.transport === "attached" && isInsideRepository ? { canOpen: true } : null,
      code: {
        focus: {
          startLine: finding.line,
          startColumn: finding.column,
          endLine: finding.endLine,
          endColumn: finding.endColumn,
        },
      },
      guidance: {
        summary: rule.standard.summary ?? null,
        standard: guidance.standard,
        checks: [...guidance.checks],
        examples: guidance.examples.map((example) => ({
          label: example.label ?? null,
          description: example.description ?? null,
          code: example.code,
        })),
        references,
      },
      status:
        options.mode === "calibration"
          ? options.session?.calibration.some((item) => item.findingId === id)
            ? "accepted"
            : "unresolved"
          : options.session?.requested.has(id)
            ? "changes_requested"
            : acceptance
              ? "accepted"
              : "unresolved",
      acceptance: acceptance
        ? {
            reason: acceptance.reason,
            actor: acceptance.actor ?? "unknown",
            at: acceptance.acceptedAt,
            authority: acceptance.authority,
          }
        : null,
      lineageReason: lineage
        ? `${reasons.join(" ")} Previous decision by ${lineage.actor ?? "unknown"} (${lineage.authority}, ${lineage.acceptedAt}): ${lineage.reason}`
        : null,
      proposal: proposal
        ? { summary: proposal.summary, diff: proposal.diff ?? null, actor: proposal.actor, at: proposal.proposedAt }
        : null,
      identity: { source: finding.source, fingerprint: finding.fingerprint, lineageKey: finding.lineageKey ?? null },
    });
  }

  return {
    version: 3,
    sources: collection.sources,
    coverage: {
      scope: collection.scope,
      files: [...collection.scannedFiles],
      rules: [...collection.availableRules],
    },
    mode: options.mode,
    transport: options.transport,
    project: path.basename(env.cwd),
    base: collection.base ?? options.base ?? config.base ?? "working tree",
    generatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    applications: options.transport === "attached" ? [...(options.applications ?? [])] : [],
    findings,
    calibration: findings.flatMap((finding) => {
      const feedback = options.session?.calibration.find((item) => item.findingId === finding.id);
      return feedback
        ? [
            {
              findingId: finding.id,
              identity: finding.identity,
              ruleId: finding.ruleId,
              file: finding.file,
              classification: feedback.classification,
              reason: feedback.reason,
              note: feedback.note,
              invalidationReasons: finding.invalidationReasons,
            },
          ]
        : [];
    }),
    detached: options.transport === "detached" ? { source: options.source ?? "review artifact" } : null,
  } satisfies ReviewStatePayload;
});

function replaceByFindingId<T extends { readonly findingId: string }>(items: T[], next: T): void {
  const index = items.findIndex((item) => item.findingId === next.findingId);
  if (index === -1) items.push(next);
  else items[index] = next;
}

export interface ReviewSelection {
  readonly base?: string | undefined;
  readonly rules?: ReadonlyArray<string> | undefined;
  readonly files?: ReadonlyArray<string> | undefined;
}

/**
 * Scan the reviewed selection and return the finding with this id, without building the review payload.
 */
export const findReviewFinding = Effect.fn("findReviewFinding")(function* (
  findingId: string,
  selection: ReviewSelection,
) {
  const collection = yield* collectFindings({
    all: true,
    rules: [...(selection.rules ?? [])],
    base: selection.base,
    files: [...(selection.files ?? [])],
  });
  return collection.findings.find((candidate) => findingKey(candidate) === findingId);
});

export const applyReviewAction = Effect.fn("applyReviewAction")(function* (
  action: ReviewActionRequest,
  options: ReviewSelection & { readonly mode: ReviewMode; readonly session: ReviewSessionState },
) {
  const finding = yield* findReviewFinding(action.findingId, options);
  if (!finding) {
    return {
      ok: false,
      message: "The finding changed or no longer exists. Refresh the review.",
    } satisfies ReviewActionResult;
  }

  const forget = (): void => {
    options.session.requested.delete(action.findingId);
    const index = options.session.feedback.findIndex((item) => item.findingId === action.findingId);
    if (index !== -1) options.session.feedback.splice(index, 1);
  };

  if (action.type === "accept") {
    if (options.mode !== "review") {
      return { ok: false, message: "Calibration cannot create acceptances." } satisfies ReviewActionResult;
    }
    if (!action.reason?.trim()) {
      return { ok: false, message: "An acceptance reason is required." } satisfies ReviewActionResult;
    }
    const result = yield* acceptFinding(finding, {
      authority: "human",
      reason: action.reason,
      actor: "human:local-review",
    });
    if (result.exitCode === 0) {
      forget();
      const stored = (yield* (yield* AcceptanceStore).read()).byKey.get(action.findingId);
      options.session.served.set(
        action.findingId,
        stored ? { acceptedAt: stored.acceptedAt, reason: stored.reason } : null,
      );
    }
    return { ok: result.exitCode === 0, message: result.message } satisfies ReviewActionResult;
  }

  // Revoke only the stored decision this session was last shown. One recorded since then, by another tab
  // or by `agentlint approve`, was never reviewed here and must survive.
  const revokeServed = Effect.fn(function* () {
    const store = yield* AcceptanceStore;
    const served = options.session.served.get(action.findingId);
    if (!served) return !(yield* store.read()).byKey.has(action.findingId);
    const revoked = yield* store
      .reconcile({
        scope: "partial",
        current: [finding],
        revoked: [{ ...finding, expectedAcceptedAt: served.acceptedAt, expectedReason: served.reason }],
      })
      .pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.reason === "invalid_acceptance",
          () => Effect.succeed(false),
        ),
      );
    if (revoked) options.session.served.set(action.findingId, null);
    return revoked;
  });
  const conflict = {
    ok: false,
    message: "The recorded decision changed after this review loaded. Refresh the review.",
  } satisfies ReviewActionResult;

  if (action.type === "withdraw") {
    if (options.mode !== "review")
      return { ok: false, message: "Calibration cannot revoke acceptances." } satisfies ReviewActionResult;
    // Return the finding to unresolved: drop this session's change request and revoke the stored
    // decision, whoever recorded it.
    if (!(yield* revokeServed())) return conflict;
    forget();
    return { ok: true, message: "Decision withdrawn." } satisfies ReviewActionResult;
  }

  if (action.type === "request_changes") {
    if (options.mode !== "review")
      return { ok: false, message: "Calibration cannot request changes." } satisfies ReviewActionResult;
    if (!(yield* revokeServed())) return conflict;
    // An empty request still tells the agent exactly which finding to revisit; the
    // finding message and standard carry the instruction.
    replaceByFindingId(options.session.feedback, {
      findingId: action.findingId,
      ruleId: finding.ruleId,
      file: finding.file,
      line: finding.line,
      message: finding.message,
      comment: action.reason?.trim() || finding.message,
    });
    options.session.requested.add(action.findingId);
    return { ok: true, message: "Change request recorded." } satisfies ReviewActionResult;
  }

  if (options.mode !== "calibration") {
    return {
      ok: false,
      message: "Calibration labels are available only in calibration mode.",
    } satisfies ReviewActionResult;
  }
  if (!action.calibration) {
    return { ok: false, message: "Select a calibration result." } satisfies ReviewActionResult;
  }
  if (action.calibration === "does_not_apply" && action.reason === null)
    return { ok: false, message: "Select why this finding does not apply." } satisfies ReviewActionResult;
  replaceByFindingId(options.session.calibration, {
    findingId: action.findingId,
    ruleId: finding.ruleId,
    file: finding.file,
    classification: action.calibration,
    reason: action.calibration === "does_not_apply" ? action.reason : null,
    note: action.note?.trim() ?? "",
  });
  return { ok: true, message: "Calibration feedback recorded." } satisfies ReviewActionResult;
});
