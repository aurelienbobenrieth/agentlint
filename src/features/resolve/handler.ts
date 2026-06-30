import { Effect } from "effect";
import { Env } from "../../config/env.js";
import { normalizeConfig, policyForRule } from "../../domain/config.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { LedgerRecord, LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { resolveFindingSelector } from "../../shared/pipeline/selectors.js";
import { ResolveCommand, ResolveResult } from "./request.js";

export const resolveHandler = Effect.fn("resolveHandler")(function* (command: ResolveCommand) {
  const env = yield* Env;
  const configLoader = yield* ConfigLoader;
  const ledgerStore = yield* LedgerStore;
  const selectorCache = yield* SelectorCache;

  if (command.interactive) {
    return new ResolveResult({
      message:
        "Interactive resolution is not available yet. Run agentlint check, then resolve a selector with --accept, --defer, or --no-fix and --reason.",
      exitCode: 2,
    });
  }

  if (!command.selector) {
    return new ResolveResult({ message: "Missing selector. Run agentlint resolve <selector> ...", exitCode: 2 });
  }
  if (!command.status) {
    return new ResolveResult({ message: "Missing disposition flag: --accept, --defer, or --no-fix.", exitCode: 2 });
  }
  if (!command.reason || command.reason.trim().length === 0) {
    return new ResolveResult({ message: 'Missing reason. Pass --reason "...".', exitCode: 2 });
  }

  const config = normalizeConfig(yield* configLoader.load());
  const cache = yield* selectorCache.read();
  const collection = yield* collectFindings({ all: true, rules: [], base: undefined, files: [] });
  const resolution = resolveFindingSelector(command.selector, collection.findings, cache);
  if (!resolution.ok) {
    return new ResolveResult({ message: resolution.message, exitCode: 2 });
  }

  const finding = resolution.finding;
  const policy = policyForRule(config, finding.ruleId);
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
  return new ResolveResult({
    message: result.appended
      ? `Recorded ${command.status} for ${finding.ruleId} ${finding.file}:${finding.line}.`
      : `Disposition already recorded for ${finding.ruleId} ${finding.file}:${finding.line}.`,
    exitCode: 0,
  });
});
