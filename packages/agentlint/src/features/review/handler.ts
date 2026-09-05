/** Review payload and action application. @module @since 0.2.0 */

import { Effect, Path } from "effect";
import type { CheckResult } from "../check/request.js";
import { acceptanceKey } from "../../domain/acceptance.js";
import { Env } from "../../config/env.js";
import { findLineage, invalidationReasons } from "../../domain/acceptance.js";
import { findingKey } from "../../domain/finding.js";
import { normalizeGuidance } from "../../domain/guidance.js";
import { findProposal } from "../../domain/proposal.js";
import { acceptFinding } from "../accept/handler.js";
import { AcceptanceStore, lookupAcceptance } from "../../shared/infrastructure/acceptance-store.js";
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
}

const browserHref = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

export function makeReviewSessionState(): ReviewSessionState {
  return { feedback: [], calibration: [], requested: new Set() };
}

export interface BuildReviewPayloadOptions {
  readonly check?: CheckResult;
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
    options.check ?? (yield* collectFindings({ all: true, rules: [], base: options.base ?? config.base, files: [] }));
  const findings: ReviewFindingPayload[] = [];

  for (const finding of collection.findings) {
    const rule = config.rulesById.get(finding.ruleId);
    if (!rule) continue;
    const id = findingKey(finding);
    const acceptance = lookupAcceptance(snapshot, finding);
    const lineage = findLineage(snapshot.records, finding);
    const proposal = findProposal(proposals, finding);
    const absoluteFile = path.resolve(env.cwd, finding.file);
    const relativeFile = path.relative(env.cwd, absoluteFile);
    const isInsideRepository =
      relativeFile !== ".." &&
      !relativeFile.startsWith("../") &&
      !relativeFile.startsWith("..\\") &&
      !path.isAbsolute(relativeFile);
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
      status: options.session?.requested.has(id) ? "changes_requested" : acceptance ? "accepted" : "unresolved",
      acceptance: acceptance
        ? {
            reason: acceptance.reason,
            actor: acceptance.actor ?? "unknown",
            at: acceptance.acceptedAt,
            authority: acceptance.authority,
          }
        : null,
      lineageReason: lineage
        ? `${invalidationReasons(lineage, finding).join(" ")} Previous decision by ${lineage.actor ?? "unknown"} (${lineage.authority}, ${lineage.acceptedAt}): ${lineage.reason}`
        : null,
      proposal: proposal
        ? { summary: proposal.summary, diff: proposal.diff ?? null, actor: proposal.actor, at: proposal.proposedAt }
        : null,
      identity: { source: finding.source, fingerprint: finding.fingerprint, lineageKey: finding.lineageKey ?? null },
    });
  }

  return {
    version: 2,
    sources: collection.sources,
    coverage: {
      scope: collection.scope,
      files: [...collection.scannedFiles],
      rules: options.check?.availableRules ?? config.rules.map((rule) => rule.binding.id),
    },
    mode: options.mode,
    transport: options.transport,
    project: path.basename(env.cwd),
    base: collection.base ?? options.base ?? config.base ?? "working tree",
    generatedAt: new Date().toISOString(),
    applications: options.transport === "attached" ? [...(options.applications ?? [])] : [],
    findings,
    detached:
      options.transport === "detached"
        ? { source: options.source ?? "review artifact", canPersistAcceptances: false }
        : null,
  } satisfies ReviewStatePayload;
});

function replaceByFindingId<T extends { readonly findingId: string }>(items: T[], next: T): void {
  const index = items.findIndex((item) => item.findingId === next.findingId);
  if (index === -1) items.push(next);
  else items[index] = next;
}

export const applyReviewAction = Effect.fn("applyReviewAction")(function* (
  action: ReviewActionRequest,
  options: { readonly base?: string | undefined; readonly mode: ReviewMode; readonly session: ReviewSessionState },
) {
  const collection = yield* collectFindings({ all: true, rules: [], base: options.base, files: [] });
  const finding = collection.findings.find((candidate) => findingKey(candidate) === action.findingId);
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
    const result = yield* acceptFinding(finding, { authority: "human", reason: action.reason });
    if (result.exitCode === 0) forget();
    return { ok: result.exitCode === 0, message: result.message } satisfies ReviewActionResult;
  }

  if (action.type === "withdraw") {
    if (options.mode !== "review")
      return { ok: false, message: "Calibration cannot revoke acceptances." } satisfies ReviewActionResult;
    // Undo a decision made in this session: drop the change request and any acceptance
    // that currently satisfies this exact finding.
    forget();
    const store = yield* AcceptanceStore;
    yield* store.reconcile({ scope: "partial", current: [finding], revoked: [finding] });
    return { ok: true, message: "Decision withdrawn." } satisfies ReviewActionResult;
  }

  if (action.type === "request_changes") {
    if (options.mode !== "review")
      return { ok: false, message: "Calibration cannot revoke acceptances." } satisfies ReviewActionResult;
    yield* (yield* AcceptanceStore).reconcile({ scope: "partial", current: [finding], revoked: [finding] });
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
  replaceByFindingId(options.session.calibration, {
    findingId: action.findingId,
    ruleId: finding.ruleId,
    file: finding.file,
    classification: action.calibration,
    note: action.note?.trim() ?? "",
  });
  return { ok: true, message: "Calibration feedback recorded." } satisfies ReviewActionResult;
});
