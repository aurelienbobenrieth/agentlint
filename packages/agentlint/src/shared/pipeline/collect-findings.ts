/** Finding collection for state and change rules. @module @since 0.2.0 */

import { Effect, FileSystem, Path, Schema } from "effect";
import picomatch from "picomatch";
import { Env } from "../../config/env.js";
import { ChangeRuleContextImpl } from "../../domain/change-rule-context.js";
import { normalizeConfig, type NormalizedConfig } from "../../domain/config.js";
import { FindingRecord } from "../../domain/finding.js";
import {
  ruleMatches,
  type AgentlintRule,
  type ChangeRule,
  type RuleMatch,
  type StateRule,
  type Visitors,
} from "../../domain/rule.js";
import { RuleContextImpl } from "../../domain/rule-context.js";
import { ConfigLoader } from "../infrastructure/config-loader.js";
import { Git } from "../infrastructure/git.js";
import { Parser } from "../infrastructure/parser.js";
import { resolveFiles } from "./file-resolver.js";
import { grammarForExtension } from "./language-map.js";
import { compileMatches, resolveWhereClauses, runMatches, type RunnableMatches } from "./pattern-match.js";
import { visitorKeys, walkFile } from "./tree-walker.js";

export const CollectResult = Schema.Struct({
  findings: Schema.Array(FindingRecord),
  noMatchingRules: Schema.Boolean,
  availableRules: Schema.Array(Schema.String),
  scope: Schema.Literals(["partial", "complete"]),
  base: Schema.UndefinedOr(Schema.String),
});
export type CollectResult = Schema.Schema.Type<typeof CollectResult>;

export const CollectOptions = Schema.Struct({
  all: Schema.Boolean,
  rules: Schema.Array(Schema.String),
  base: Schema.UndefinedOr(Schema.String),
  files: Schema.Array(Schema.String),
});
export type CollectOptions = Schema.Schema.Type<typeof CollectOptions>;

export class DetectionError extends Schema.TaggedError<DetectionError>()("agentlint/DetectionError", {
  ruleId: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Rule ${this.ruleId} failed: ${this.detail}`;
  }
}

interface StateRuleEntry {
  readonly rule: StateRule;
  readonly context: RuleContextImpl;
  readonly visitors: Visitors;
  readonly keys: ReadonlyArray<string>;
  readonly matches: ReadonlyArray<RuleMatch>;
  readonly compiledByGrammar: Map<string, RunnableMatches>;
}

function matchesScope(rule: AgentlintRule, file: string): boolean {
  const included = rule.binding.include?.length ? picomatch([...rule.binding.include])(file) : true;
  const excluded = rule.binding.exclude?.length ? picomatch([...rule.binding.exclude])(file) : false;
  return included && !excluded;
}

function filterRules(config: NormalizedConfig, requested: ReadonlyArray<string>): ReadonlyArray<AgentlintRule> {
  if (requested.length === 0) return config.rules;
  return config.rules.filter((rule) => requested.includes(rule.binding.id));
}

function sortFindings(findings: ReadonlyArray<FindingRecord>): FindingRecord[] {
  return findings.toSorted(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.fingerprint.digest.localeCompare(right.fingerprint.digest),
  );
}

export const collectFindings = Effect.fn("collectFindings")(function* (options: CollectOptions) {
  const configLoader = yield* ConfigLoader;
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* Git;
  const parser = yield* Parser;
  const config = normalizeConfig(yield* configLoader.load());
  const availableRules = config.rules.map((rule) => rule.binding.id).toSorted();
  const activeRules = filterRules(config, options.rules);
  const scope: CollectResult["scope"] =
    options.all && options.files.length === 0 && options.rules.length === 0 ? "complete" : "partial";

  if (activeRules.length === 0) {
    return { findings: [], noMatchingRules: true, availableRules, scope, base: options.base ?? config.base };
  }

  const stateRules = activeRules.filter((rule): rule is StateRule => rule.lifecycle === "state");
  const changeRules = activeRules.filter((rule): rule is ChangeRule => rule.lifecycle === "change");
  const findings: FindingRecord[] = [];

  if (stateRules.length > 0) {
    const files = yield* resolveFiles(
      {
        all: options.all,
        baseRef: options.base ?? config.base,
        configIgnores: config.ignores.length ? [...config.ignores] : undefined,
        positionalFiles: options.files.length ? [...options.files] : undefined,
      },
      git,
    );
    const entries: StateRuleEntry[] = stateRules.map((rule) => {
      const context = new RuleContextImpl(rule);
      const visitors = rule.detector.createOnce?.(context, rule.binding.options) ?? {};
      return {
        rule,
        context,
        visitors,
        keys: visitorKeys(visitors),
        matches: ruleMatches(rule),
        compiledByGrammar: new Map(),
      };
    });

    for (const file of files) {
      const grammar = grammarForExtension(path.extname(file).slice(1));
      if (!grammar) continue;
      const sourceResult = yield* fs.readFileString(path.resolve(env.cwd, file)).pipe(Effect.result);
      if (sourceResult._tag === "Failure") continue;
      const source = sourceResult.success;
      const applicable = entries.filter((entry) => matchesScope(entry.rule, file));
      if (applicable.length === 0) continue;
      const runnable: Array<{ ruleId: string; context: RuleContextImpl; visitors: Visitors }> = [];
      const tree = yield* parser.parse(source, grammar);

      for (const entry of applicable) {
        entry.context.setFile(path.resolve(env.cwd, file), file, source);
        if (entry.visitors.before?.(path.resolve(env.cwd, file)) === false) continue;
        if (entry.matches.length > 0) {
          let compiled = entry.compiledByGrammar.get(grammar);
          if (!compiled) {
            const patterns = yield* compileMatches({
              ruleId: entry.rule.binding.id,
              matches: entry.matches,
              grammar,
            });
            compiled = yield* resolveWhereClauses(entry.rule.binding.id, patterns, grammar);
            entry.compiledByGrammar.set(grammar, compiled);
          }
          runMatches(tree, compiled, entry.context);
        }
        if (entry.keys.length > 0) {
          runnable.push({ ruleId: entry.rule.binding.id, context: entry.context, visitors: entry.visitors });
        }
      }

      findings.push(...walkFile(tree, runnable));
    }

    for (const entry of entries) {
      entry.visitors.after?.();
      findings.push(...entry.context.drainFindings());
    }
  }

  let selectedBase = options.base ?? config.base;
  if (changeRules.length > 0) {
    const change = yield* git.changeSet(selectedBase);
    selectedBase = change.baseline.ref;
    const explicitMatcher = options.files.length ? picomatch([...options.files]) : undefined;
    const ignoreMatcher = config.ignores.length ? picomatch([...config.ignores]) : undefined;

    for (const rule of changeRules) {
      const filteredChange = {
        ...change,
        files: change.files.filter(
          (file) =>
            matchesScope(rule, file.path) &&
            (!ignoreMatcher || !ignoreMatcher(file.path)) &&
            (!explicitMatcher || explicitMatcher(file.path)),
        ),
      };
      if (filteredChange.files.length === 0) continue;
      const context = new ChangeRuleContextImpl(rule, filteredChange, (file) => path.resolve(env.cwd, file));
      yield* Effect.try({
        try: () => rule.detector.detect(context, rule.binding.options),
        catch: (error) => new DetectionError({ ruleId: rule.binding.id, detail: String(error) }),
      });
      findings.push(...context.findings);
    }
  }

  return {
    findings: sortFindings(findings),
    noMatchingRules: false,
    availableRules,
    scope,
    base: selectedBase,
  };
});

export { matchesScope as ruleEnabledForFile };
