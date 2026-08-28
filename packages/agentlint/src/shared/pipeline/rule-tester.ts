/** Detector fixture runners. @module @since 0.2.0 */

import { createHash } from "node:crypto";
import { Effect } from "effect";
import { ChangeRuleContextImpl } from "../../domain/change-rule-context.js";
import type { FindingRecord } from "../../domain/finding.js";
import {
  ruleMatches,
  type AgentlintRule,
  type ChangeFixture,
  type ChangeRule,
  type ChangeSet,
  type ChangedFile,
  type StateFixture,
  type StateRule,
} from "../../domain/rule.js";
import { RuleContextImpl } from "../../domain/rule-context.js";
import { Parser } from "../infrastructure/parser.js";
import { grammarForExtension } from "./language-map.js";
import { compileMatches, PatternError, resolveWhereClauses, runMatches } from "./pattern-match.js";
import { walkFile } from "./tree-walker.js";

/** Run one state detector against an in-memory repository. */
export const runRuleOnSources = Effect.fn("runRuleOnSources")(function* (
  rule: StateRule,
  sources: ReadonlyArray<readonly [file: string, source: string]>,
) {
  const parser = yield* Parser;
  const context = new RuleContextImpl(rule);
  const visitors = rule.detector.createOnce?.(context, rule.binding.options) ?? {};
  const findings: FindingRecord[] = [];

  for (const [file, source] of sources) {
    const extension = file.includes(".") ? (file.split(".").pop() ?? "") : "";
    const grammar = grammarForExtension(extension);
    if (!grammar) {
      return yield* new PatternError({ ruleId: rule.binding.id, reason: "unknown_fixture_grammar", detail: file });
    }
    context.setFile(file, file, source);
    if (visitors.before?.(file) === false) continue;
    const tree = yield* parser.parse(source, grammar);
    const matches = ruleMatches(rule);
    if (matches.length > 0) {
      const compiled = yield* compileMatches({ ruleId: rule.binding.id, matches, grammar });
      const runnable = yield* resolveWhereClauses(rule.binding.id, compiled, grammar);
      runMatches(tree, runnable, context);
    }
    findings.push(...walkFile(tree, [{ ruleId: rule.binding.id, context, visitors }]));
    findings.push(...context.drainFindings());
  }
  visitors.after?.();
  findings.push(...context.drainFindings());
  return findings as ReadonlyArray<FindingRecord>;
});

/** Run one state detector against one source file. */
export const runRuleOnSource = Effect.fn("runRuleOnSource")(function* (
  rule: StateRule,
  source: string,
  file = "fixture.tsx",
) {
  return yield* runRuleOnSources(rule, [[file, source]]);
});

/**
 * Run one change detector against an already normalized change. Findings use
 * the same fingerprint and lineage construction as `agentlint check`; the
 * absolute path is the fixture path itself.
 */
export function runRuleOnChange(rule: ChangeRule, change: ChangeSet): ReadonlyArray<FindingRecord> {
  const context = new ChangeRuleContextImpl(rule, change, (file) => file);
  rule.detector.detect(context, rule.binding.options);
  return context.findings;
}

/** Same digest as the Git change source, so fixture snapshots match real evidence. */
function snapshot(content: string): { readonly content: string; readonly digest: string } {
  return { content, digest: createHash("sha256").update(content).digest("hex") };
}

/** Normalize a compact before-and-after fixture to the public change contract. */
export function normalizeChangeFixture(fixture: ChangeFixture): ChangeSet {
  if ("change" in fixture) return fixture.change;
  const before = fixture.before ?? {};
  const after = fixture.after ?? {};
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].toSorted();
  const files: ChangedFile[] = [];
  for (const path of paths) {
    const oldContent = before[path];
    const newContent = after[path];
    if (oldContent === newContent) continue;
    const status = oldContent === undefined ? "added" : newContent === undefined ? "deleted" : "modified";
    const oldLines = oldContent?.split("\n") ?? [];
    const newLines = newContent?.split("\n") ?? [];
    files.push({
      status,
      path: path.replace(/\\/g, "/"),
      before: oldContent === undefined ? null : snapshot(oldContent),
      after: newContent === undefined ? null : snapshot(newContent),
      hunks: [
        {
          oldStart: oldLines.length === 0 ? 0 : 1,
          oldLines: oldLines.length,
          newStart: newLines.length === 0 ? 0 : 1,
          newLines: newLines.length,
          lines: [
            ...oldLines.map((content) => ({ kind: "deletion" as const, content })),
            ...newLines.map((content) => ({ kind: "addition" as const, content })),
          ],
        },
      ],
    });
  }
  return { baseline: { kind: "git", ref: "fixture" }, files };
}

export interface FixtureFailure {
  readonly expectation: "mustReport" | "mustStaySilent";
  readonly index: number;
  readonly label?: string | undefined;
  readonly findingCount: number;
}

export interface FixtureReport {
  readonly ruleId: string;
  readonly total: number;
  readonly failures: ReadonlyArray<FixtureFailure>;
}

function stateFiles(fixture: StateFixture): ReadonlyArray<readonly [string, string]> {
  if (typeof fixture === "string") return [["fixture.tsx", fixture]];
  if ("source" in fixture) return [[fixture.file ?? "fixture.tsx", fixture.source]];
  return Object.entries(fixture.files).toSorted(([left], [right]) => left.localeCompare(right));
}

function fixtureLabel(fixture: StateFixture | ChangeFixture): string | undefined {
  return typeof fixture === "string" ? undefined : fixture.label;
}

const runStateFixture = Effect.fn("runStateFixture")(function* (rule: StateRule, fixture: StateFixture) {
  return (yield* runRuleOnSources(rule, stateFiles(fixture))).length;
});

/** Run activation and silence fixtures for either lifecycle. */
export const runRuleFixtures = Effect.fn("runRuleFixtures")(function* (rule: AgentlintRule) {
  const fixtures = rule.detector.fixtures;
  const mustReport = fixtures?.mustReport ?? [];
  const mustStaySilent = fixtures?.mustStaySilent ?? [];
  const failures: FixtureFailure[] = [];

  for (const [index, fixture] of mustReport.entries()) {
    const count =
      rule.lifecycle === "state"
        ? yield* runStateFixture(rule, fixture as StateFixture)
        : runRuleOnChange(rule, normalizeChangeFixture(fixture as ChangeFixture)).length;
    if (count === 0) failures.push({ expectation: "mustReport", index, label: fixtureLabel(fixture), findingCount: 0 });
  }
  for (const [index, fixture] of mustStaySilent.entries()) {
    const count =
      rule.lifecycle === "state"
        ? yield* runStateFixture(rule, fixture as StateFixture)
        : runRuleOnChange(rule, normalizeChangeFixture(fixture as ChangeFixture)).length;
    if (count > 0)
      failures.push({ expectation: "mustStaySilent", index, label: fixtureLabel(fixture), findingCount: count });
  }

  return {
    ruleId: rule.binding.id,
    total: mustReport.length + mustStaySilent.length,
    failures,
  } satisfies FixtureReport;
});
