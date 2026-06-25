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
import type { AgentlintRule, Visitors } from "../../domain/rule.js";
import { RuleContextImpl } from "../../domain/rule-context.js";
import { ConfigLoader } from "../infrastructure/config-loader.js";
import { Git } from "../infrastructure/git.js";
import { Parser } from "../infrastructure/parser.js";
import { resolveFiles } from "./file-resolver.js";
import { grammarForExtension } from "./language-map.js";
import { visitorKeys, walkFile } from "./tree-walker.js";

export const CollectResult = Schema.Struct({
  findings: Schema.Array(FindingRecord),
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
      return { findings: [], noMatchingRules: true, availableRules };
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
    const visitors = rule.createOnce(context);
    ruleEntries.push({ ruleId, rule, context, visitors, keys: visitorKeys(visitors) });
  }

  const allFindings: FindingRecord[] = [];

  for (const file of files) {
    const ext = path.extname(file).slice(1);
    const grammar = grammarForExtension(ext);
    if (!grammar) continue;

    const absPath = path.resolve(env.cwd, file);
    const sourceResult = yield* fs.readFileString(absPath).pipe(Effect.result);
    if (sourceResult._tag === "Failure") continue;
    const source = sourceResult.success;

    const rulesForFile = ruleEntries.filter((entry) => ruleEnabledForFile(config, file, entry.ruleId));
    if (rulesForFile.length === 0) continue;

    const runnableRules: Array<{
      ruleId: string;
      context: RuleContextImpl;
      visitors: Visitors;
    }> = [];

    for (const entry of rulesForFile) {
      entry.context.setFile(absPath, file, source);
      const beforeResult = entry.visitors.before?.(absPath);
      if (beforeResult === false || entry.keys.length === 0) continue;
      runnableRules.push({
        ruleId: entry.ruleId,
        context: entry.context,
        visitors: entry.visitors,
      });
    }

    if (runnableRules.length === 0) continue;

    const tree = yield* parserService.parse(source, grammar);
    allFindings.push(...walkFile(tree, runnableRules));
  }

  for (const entry of ruleEntries) {
    entry.visitors.after?.();
    allFindings.push(...entry.context.drainFindings());
  }

  return {
    findings: sortFindings(allFindings),
    noMatchingRules: false,
    availableRules,
  };
});

export { ruleEnabledForFile };
