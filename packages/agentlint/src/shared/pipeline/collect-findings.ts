/**
 * Finding collection pipeline.
 *
 * Config owns broad file routing. Rule definitions own detection logic and
 * visitor shape. A rule's `createOnce` is called once per collection run, and
 * the returned visitor object is reused across files.
 *
 * @module
 * @since 0.2.0
 */

import { Effect, FileSystem, Path, Schema } from "effect";
import picomatch from "picomatch";
import { Env } from "../../config/env.js";
import { normalizeConfig, type NormalizedConfig } from "../../domain/config.js";
import { FindingRecord } from "../../domain/finding.js";
import { ruleMatches, type AgentlintRule, type RuleMatch, type Visitors } from "../../domain/rule.js";
import { RuleContextImpl } from "../../domain/rule-context.js";
import { ConfigLoader } from "../infrastructure/config-loader.js";
import { Git } from "../infrastructure/git.js";
import { matchNotes, MatchedNote, NotesStore } from "../infrastructure/notes-store.js";
import { Parser } from "../infrastructure/parser.js";
import { resolveFiles } from "./file-resolver.js";
import { grammarForExtension } from "./language-map.js";
import { compileMatches, resolveWhereClauses, runMatches, type RunnableMatches } from "./pattern-match.js";
import { visitorKeys, walkFile } from "./tree-walker.js";

export const CollectResult = Schema.Struct({
  findings: Schema.Array(FindingRecord),
  notes: Schema.Array(MatchedNote),
  noMatchingRules: Schema.Boolean,
  availableRules: Schema.Array(Schema.String),
});

export type CollectResult = Schema.Schema.Type<typeof CollectResult>;

export const CollectOptions = Schema.Struct({
  all: Schema.Boolean,
  rules: Schema.Array(Schema.String),
  base: Schema.UndefinedOr(Schema.String),
  files: Schema.Array(Schema.String),
});

export type CollectOptions = Schema.Schema.Type<typeof CollectOptions>;

interface RuleEntry {
  readonly ruleId: string;
  readonly rule: AgentlintRule;
  readonly context: RuleContextImpl;
  readonly visitors: Visitors;
  readonly keys: ReadonlyArray<string>;
  readonly matches: ReadonlyArray<RuleMatch>;
  /** Compiled matches, cached per grammar for the duration of one run. */
  readonly compiledByGrammar: Map<string, RunnableMatches>;
}

function matcher(patterns: ReadonlyArray<string> | undefined): ((file: string) => boolean) | undefined {
  return patterns && patterns.length > 0 ? picomatch([...patterns]) : undefined;
}

function ruleEnabledForFile(config: NormalizedConfig, file: string, ruleId: string): boolean {
  let enabled = true;

  for (const override of config.overrides) {
    const filesMatcher = matcher(override.files);
    if (!filesMatcher?.(file)) continue;

    const ignoresMatcher = matcher(override.ignores);
    if (ignoresMatcher?.(file)) continue;

    const state = override.rules[ruleId];
    if (state) {
      enabled = state === "on";
    }
  }

  return enabled;
}

function sortFindings(findings: ReadonlyArray<FindingRecord>): FindingRecord[] {
  return findings.toSorted(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.message.localeCompare(b.message),
  );
}

export const collectFindings = Effect.fn("collectFindings")(function* (options: CollectOptions) {
  const configLoader = yield* ConfigLoader;
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const gitService = yield* Git;
  const parserService = yield* Parser;

  const config = normalizeConfig(yield* configLoader.load());
  const availableRules = Object.keys(config.rules).toSorted();

  let activeRules: Array<[string, AgentlintRule]> = Object.entries(config.rules);
  if (options.rules.length > 0) {
    activeRules = activeRules.filter(([id]) => options.rules.includes(id));
    if (activeRules.length === 0) {
      return { findings: [], notes: [], noMatchingRules: true, availableRules };
    }
  }

  const files = yield* resolveFiles(
    {
      all: options.all,
      baseRef: options.base,
      configFiles: config.files ? [...config.files] : undefined,
      configIgnores: config.ignores.length > 0 ? [...config.ignores] : undefined,
      positionalFiles: options.files.length > 0 ? [...options.files] : undefined,
    },
    gitService,
  );

  const ruleEntries: RuleEntry[] = [];
  for (const [ruleId, rule] of activeRules) {
    const context = new RuleContextImpl(ruleId);
    const visitors = rule.createOnce?.(context) ?? {};
    ruleEntries.push({
      ruleId,
      rule,
      context,
      visitors,
      keys: visitorKeys(visitors),
      matches: ruleMatches(rule),
      compiledByGrammar: new Map(),
    });
  }

  const allFindings: FindingRecord[] = [];
  const scannedForNotes: Array<{ file: string; source: string }> = [];

  for (const file of files) {
    const ext = path.extname(file).slice(1);
    const grammar = grammarForExtension(ext);

    const absPath = path.resolve(env.cwd, file);
    const sourceResult = yield* fs.readFileString(absPath).pipe(Effect.result);
    if (sourceResult._tag === "Failure") continue;
    const source = sourceResult.success;
    scannedForNotes.push({ file, source });
    if (!grammar) continue;

    const rulesForFile = ruleEntries.filter((entry) => ruleEnabledForFile(config, file, entry.ruleId));
    if (rulesForFile.length === 0) continue;

    const runnableRules: Array<{
      ruleId: string;
      context: RuleContextImpl;
      visitors: Visitors;
    }> = [];
    const matchRules: RuleEntry[] = [];

    for (const entry of rulesForFile) {
      entry.context.setFile(absPath, file, source);
      const beforeResult = entry.visitors.before?.(absPath);
      if (beforeResult === false || (entry.keys.length === 0 && entry.matches.length === 0)) continue;
      if (entry.matches.length > 0) matchRules.push(entry);
      runnableRules.push({
        ruleId: entry.ruleId,
        context: entry.context,
        visitors: entry.visitors,
      });
    }

    if (runnableRules.length === 0) continue;

    const tree = yield* parserService.parse(source, grammar);

    for (const entry of matchRules) {
      let runnable = entry.compiledByGrammar.get(grammar);
      if (!runnable) {
        const compiled = yield* compileMatches({ ruleId: entry.ruleId, matches: entry.matches, grammar });
        runnable = yield* resolveWhereClauses(entry.ruleId, compiled, grammar);
        entry.compiledByGrammar.set(grammar, runnable);
      }
      runMatches(tree, runnable, entry.context);
    }

    allFindings.push(...walkFile(tree, runnableRules));
  }

  for (const entry of ruleEntries) {
    entry.visitors.after?.();
    allFindings.push(...entry.context.drainFindings());
  }

  const notesStore = yield* NotesStore;
  const notes = matchNotes(yield* notesStore.load(config.noteDirs), scannedForNotes);

  return {
    findings: sortFindings(allFindings),
    notes,
    noMatchingRules: false,
    availableRules,
  };
});

export { ruleEnabledForFile };
