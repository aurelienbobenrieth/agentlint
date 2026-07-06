import { Effect } from "effect";
import { Env } from "../../config/env.js";
import { normalizeConfig, policyForRule } from "../../domain/config.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { LedgerRecord, LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { resolveFindingSelector } from "../../shared/pipeline/selectors.js";
import { ResolveCommand, ResolveResult } from "./request.js";

/**
 * Re-collect only the findings needed to verify a selector.
 *
 * When the selector maps to a cache entry from the latest check, a single
 * file/rule scan is enough. Selectors outside the cache (raw hashes,
 * `file:line`) fall back to a full scan.
 *
 * @since 0.2.0
 */
export const collectFindingsForSelector = Effect.fn("collectFindingsForSelector")(function* (selector: string) {
  const selectorCache = yield* SelectorCache;
  const cache = yield* selectorCache.read();

  const normalized = selector.trim().replace(/^\[(\d+)\]$/, "$1");
  const entry = cache.findings.find((cached) => cached.selector === normalized || cached.hash === normalized);
  if (entry) {
    const targeted = yield* collectFindings({
      all: false,
      rules: [entry.ruleId],
      base: undefined,
      files: [entry.file],
    });
    if (targeted.findings.some((finding) => finding.hash === entry.hash)) {
      return { findings: targeted.findings, cache };
    }
    // The file changed since the last check; fall through so the error
    // message reflects the full current state instead of a partial scan.
  }

  const full = yield* collectFindings({ all: true, rules: [], base: undefined, files: [] });
  return { findings: full.findings, cache };
});

export const resolveHandler = Effect.fn("resolveHandler")(function* (command: ResolveCommand) {
  const env = yield* Env;
  const configLoader = yield* ConfigLoader;
  const ledgerStore = yield* LedgerStore;

  if (command.interactive) {
    return new ResolveResult({
      message:
        "Interactive resolution is not available yet. Run agentlint check, then resolve a selector with --accept, --defer, --no-fix, or --request-approval and --reason.",
      exitCode: 2,
    });
  }

  if (!command.selector) {
    return new ResolveResult({ message: "Missing selector. Run agentlint resolve <selector> ...", exitCode: 2 });
  }
  if (!command.status) {
    return new ResolveResult({
      message: "Missing disposition flag: --accept, --defer, --no-fix, or --request-approval.",
      exitCode: 2,
    });
  }
  if (!command.reason || command.reason.trim().length === 0) {
    return new ResolveResult({ message: 'Missing reason. Pass --reason "...".', exitCode: 2 });
  }

  const config = normalizeConfig(yield* configLoader.load());
  const { findings, cache } = yield* collectFindingsForSelector(command.selector);
  const resolution = resolveFindingSelector(command.selector, findings, cache);
  if (!resolution.ok) {
    return new ResolveResult({ message: resolution.message, exitCode: 2 });
  }

  const finding = resolution.finding;
  const policy = policyForRule(config, finding.ruleId);

  if (policy.resolution === "human" && command.status === "accepted") {
    return new ResolveResult({
      message: [
        `${finding.ruleId} requires human approval; accept is not available.`,
        `Request approval: agentlint resolve ${command.selector} --request-approval --reason "..."`,
        `A human unblocks it with: agentlint approve ${command.selector} --reason "..."`,
      ].join("\n"),
      exitCode: 2,
    });
  }

  const record = new LedgerRecord({
    version: 1,
    persistence: policy.persistence === "durable" ? "durable" : undefined,
    ruleId: finding.ruleId,
    hash: finding.hash,
    status: command.status,
    reason: command.reason.trim(),
    actor: command.actor ?? env.actor,
    at: new Date().toISOString(),
    summary: undefined,
    adr: undefined,
  });

  const result = yield* ledgerStore.append(record);
  const verb = command.status === "approval_requested" ? "Requested approval" : `Recorded ${command.status}`;
  return new ResolveResult({
    message: result.appended
      ? `${verb} for ${finding.ruleId} ${finding.file}:${finding.line}.` +
        (command.status === "approval_requested"
          ? " A human reviews it with agentlint review or agentlint approve."
          : "")
      : `Disposition already recorded for ${finding.ruleId} ${finding.file}:${finding.line}.`,
    exitCode: 0,
  });
});
