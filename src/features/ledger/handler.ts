import { Effect } from "effect";
import { ledgerKey, LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { buildReviewState } from "../../shared/pipeline/review-state.js";
import { LedgerGcCommand, LedgerListCommand, LedgerResult, LedgerReviewCommand } from "./request.js";

function groupByRule<T extends { readonly ruleId: string }>(records: ReadonlyArray<T>) {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    groups.set(record.ruleId, [...(groups.get(record.ruleId) ?? []), record]);
  }
  return groups;
}

export const ledgerListHandler = Effect.fn("ledgerListHandler")(function* (command: LedgerListCommand) {
  const ledgerStore = yield* LedgerStore;
  const snapshot = yield* ledgerStore.read();
  const records = command.rule ? snapshot.records.filter((record) => record.ruleId === command.rule) : snapshot.records;

  if (records.length === 0) {
    return new LedgerResult({ message: "No ledger records.", exitCode: 0 });
  }

  const lines: string[] = [];
  const groups = groupByRule(records);
  for (const [ruleId, ruleRecords] of [...groups].toSorted(([a], [b]) => a.localeCompare(b))) {
    lines.push(ruleId);
    for (const record of ruleRecords) {
      lines.push(`  ${record.hash} ${record.status} ${record.actor} ${record.at}`);
      lines.push(`    ${record.reason}`);
    }
  }

  return new LedgerResult({ message: lines.join("\n"), exitCode: 0 });
});

export const ledgerReviewHandler = Effect.fn("ledgerReviewHandler")(function* (command: LedgerReviewCommand) {
  const state = yield* buildReviewState(command.base);

  if (command.format === "jsonl") {
    const lines = [
      ...state.pendingApprovals.map((entry) =>
        JSON.stringify({
          type: "pending_approval",
          ruleId: entry.finding.ruleId,
          hash: entry.finding.hash,
          file: entry.finding.file,
          line: entry.finding.line,
          message: entry.finding.message,
          reason: entry.disposition?.reason ?? "",
          actor: entry.disposition?.actor ?? "",
          at: entry.disposition?.at ?? "",
        }),
      ),
      ...state.newRecords.map((record) =>
        JSON.stringify({
          type: "disposition",
          ruleId: record.ruleId,
          hash: record.hash,
          status: record.status,
          reason: record.reason,
          actor: record.actor,
          at: record.at,
        }),
      ),
    ];
    return new LedgerResult({ message: lines.join("\n"), exitCode: 0 });
  }

  const lines: string[] = [`Review against ${state.base}`, ""];

  lines.push(`Pending human approval (${state.pendingApprovals.length})`);
  for (const entry of state.pendingApprovals) {
    lines.push(`  ${entry.finding.ruleId} ${entry.finding.file}:${entry.finding.line} [${entry.finding.hash}]`);
    lines.push(`    ${entry.finding.message}`);
    if (entry.disposition) {
      lines.push(`    Requested by ${entry.disposition.actor}: ${entry.disposition.reason}`);
    }
    lines.push(`    Approve: agentlint approve ${entry.finding.hash} --reason "..."`);
  }
  lines.push("");

  lines.push(`New dispositions since ${state.base} (${state.newRecords.length})`);
  for (const record of state.newRecords) {
    lines.push(`  ${record.status} ${record.ruleId} [${record.hash}] by ${record.actor}`);
    lines.push(`    ${record.reason}`);
  }
  lines.push("");

  if (state.unresolved.length > 0) {
    lines.push(`Unresolved findings: ${state.unresolved.length} (agentlint check for details)`);
  }
  if (state.staleRecords.length > 0) {
    lines.push(`Stale ledger records: ${state.staleRecords.length} (agentlint ledger gc)`);
  }

  return new LedgerResult({ message: lines.join("\n").trimEnd(), exitCode: 0 });
});

export const ledgerGcHandler = Effect.fn("ledgerGcHandler")(function* (command: LedgerGcCommand) {
  const ledgerStore = yield* LedgerStore;
  const snapshot = yield* ledgerStore.read();
  const collection = yield* collectFindings({ all: true, rules: [], base: undefined, files: [] });
  const currentKeys = new Set(collection.findings.map((finding) => ledgerKey(finding.ruleId, finding.hash)));

  const scoped = command.rule ? snapshot.records.filter((record) => record.ruleId === command.rule) : snapshot.records;
  const stale = scoped.filter((record) => !currentKeys.has(ledgerKey(record.ruleId, record.hash)));

  if (!command.write) {
    return new LedgerResult({
      message: `Dry run: ${stale.length} stale ledger record(s) would be removed. Pass --write to update .agentlint/ledger.jsonl.`,
      exitCode: 0,
    });
  }

  const staleKeys = new Set(stale.map((record) => ledgerKey(record.ruleId, record.hash)));
  const kept = snapshot.records.filter((record) => {
    if (command.rule && record.ruleId !== command.rule) return true;
    return !staleKeys.has(ledgerKey(record.ruleId, record.hash));
  });
  yield* ledgerStore.write(kept);

  return new LedgerResult({ message: `Removed ${stale.length} stale ledger record(s).`, exitCode: 0 });
});
