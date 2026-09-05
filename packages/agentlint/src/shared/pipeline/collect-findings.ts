/** Finding collection for state and change rules. @module @since 0.2.0 */

import { Effect, FileSystem, Path, Schema } from "effect";
import picomatch from "picomatch";
import { DetectionError } from "./detection-error.js";
import { Env } from "../../config/env.js";
import { ChangeRuleContextImpl } from "../../domain/change-rule-context.js";
import type { NormalizedConfig } from "../../domain/config.js";
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
import { Parser, ParserError } from "../infrastructure/parser.js";
import { FileResolverError, resolveFiles } from "./file-resolver.js";
import { grammarForExtension } from "./language-map.js";
import {
  compileMatches,
  disposeMatches,
  resolveWhereClauses,
  runMatches,
  type RunnableMatches,
} from "./pattern-match.js";
import { visitorKeys, walkFile } from "./tree-walker.js";

export const CollectResult = Schema.Struct({
  findings: Schema.Array(FindingRecord),
  sources: Schema.Record(Schema.String, Schema.String),
  scannedFiles: Schema.Array(Schema.String),
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

type ScopeMatcher = (file: string) => boolean;

interface StateRuleEntry {
  readonly rule: StateRule;
  readonly inScope: ScopeMatcher;
  readonly context: RuleContextImpl;
  readonly visitors: Visitors;
  readonly keys: ReadonlyArray<string>;
  readonly matches: ReadonlyArray<RuleMatch>;
  readonly compiledByGrammar: Map<string, RunnableMatches>;
}

/** Compile a binding's include and exclude globs into one predicate. */
function scopeMatcher(rule: AgentlintRule): ScopeMatcher {
  const included = rule.binding.include?.length ? picomatch([...rule.binding.include]) : undefined;
  const excluded = rule.binding.exclude?.length ? picomatch([...rule.binding.exclude]) : undefined;
  if (!included && !excluded) return () => true;
  return (file) => (included ? included(file) : true) && !(excluded ? excluded(file) : false);
}

/** Test one file against a binding's scope. Compiles the globs on every call; prefer `scopeMatcher` in loops. */
export function ruleEnabledForFile(rule: AgentlintRule, file: string): boolean {
  return scopeMatcher(rule)(file);
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

export const collectStateFindings = Effect.fn("collectStateFindings")(function* (
  rules: ReadonlyArray<StateRule>,
  files: ReadonlyArray<string>,
  fixtureSources?: ReadonlyMap<string, string>,
  captured?: Map<string, string>,
) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const parser = yield* Parser;
  const findings: FindingRecord[] = [];
  const entries: StateRuleEntry[] = [];
  for (const rule of rules) {
    const dependencies: Record<string, string> = {};
    for (const dependency of rule.binding.dependencies ?? []) {
      if (fixtureSources && !fixtureSources.has(dependency))
        return yield* new FileResolverError({
          reason: "filesystem",
          detail: `Missing fixture dependency: ${dependency}`,
        });
      dependencies[dependency] = yield* (
        fixtureSources
          ? Effect.succeed(fixtureSources.get(dependency) ?? "")
          : fs.readFileString(path.resolve(env.cwd, dependency))
      ).pipe(
        Effect.mapError(
          (error) =>
            new FileResolverError({ reason: "filesystem", detail: `Dependency ${dependency}: ${String(error)}` }),
        ),
      );
    }
    const context = new RuleContextImpl(rule, dependencies);
    const visitors = yield* Effect.try({
      try: () => rule.detector.createOnce?.(context, rule.binding.options) ?? {},
      catch: (cause) => new DetectionError({ ruleId: rule.binding.id, cause }),
    });
    entries.push({
      rule,
      inScope: fixtureSources
        ? (file: string) => !(rule.binding.dependencies ?? []).includes(file) || scopeMatcher(rule)(file)
        : scopeMatcher(rule),
      context,
      visitors,
      keys: visitorKeys(visitors),
      matches: ruleMatches(rule),
      compiledByGrammar: new Map(),
    });
  }

  const disposeCompiled = Effect.sync(() => {
    for (const entry of entries) {
      for (const compiled of entry.compiledByGrammar.values()) disposeMatches(compiled);
      entry.compiledByGrammar.clear();
    }
  });

  const walkOne = (file: string, absolutePath: string, source: string, grammar: string) =>
    Effect.gen(function* () {
      const applicable = entries.filter((entry) => entry.inScope(file));
      if (applicable.length === 0) return;
      const tree = yield* parser.parse(source, grammar);
      if (tree.rootNode.hasError) {
        tree.delete();
        return yield* new ParserError({
          reason: "parse_failed",
          grammar,
          detail: `${file}: syntax is incomplete or unsupported by this grammar`,
        });
      }
      const runnable: Array<{ ruleId: string; context: RuleContextImpl; visitors: Visitors }> = [];

      yield* Effect.gen(function* () {
        for (const entry of applicable) {
          entry.context.setFile(absolutePath, file, source);
          const enabled = yield* Effect.try({
            try: () => entry.visitors.before?.(absolutePath),
            catch: (cause) => new DetectionError({ ruleId: entry.rule.binding.id, cause }),
          });
          if (enabled === false) continue;
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
            const runnableMatches = compiled;
            yield* Effect.try({
              try: () => runMatches(tree, runnableMatches, entry.context),
              catch: (cause) => new DetectionError({ ruleId: entry.rule.binding.id, cause }),
            });
          }
          if (entry.keys.length > 0) {
            runnable.push({ ruleId: entry.rule.binding.id, context: entry.context, visitors: entry.visitors });
          }
        }
        findings.push(
          ...(yield* Effect.try({
            try: () => walkFile(tree, runnable),
            catch: (cause) =>
              cause instanceof DetectionError ? cause : new DetectionError({ ruleId: "tree-walker", cause }),
          })),
        );
      }).pipe(Effect.ensuring(Effect.sync(() => tree.delete())));
    });

  yield* Effect.gen(function* () {
    for (const file of files) {
      const grammar = grammarForExtension(path.extname(file).slice(1));
      if (!grammar) continue;
      const absolutePath = fixtureSources ? file : path.resolve(env.cwd, file);
      if (!entries.some((entry) => entry.inScope(file))) continue;
      const source = yield* (
        fixtureSources ? Effect.succeed(fixtureSources.get(file) ?? "") : fs.readFileString(absolutePath)
      ).pipe(
        Effect.mapError(
          (error) => new FileResolverError({ reason: "filesystem", detail: `${file}: ${String(error)}` }),
        ),
      );
      captured?.set(file, source);
      yield* walkOne(file, absolutePath, source, grammar);
    }
    for (const entry of entries) {
      yield* Effect.try({
        try: () => entry.visitors.after?.(),
        catch: (cause) => new DetectionError({ ruleId: entry.rule.binding.id, cause }),
      });
      findings.push(...entry.context.drainFindings());
    }
  }).pipe(Effect.ensuring(disposeCompiled));

  return findings;
});

export const collectFindings = Effect.fn("collectFindings")(function* (options: CollectOptions) {
  const configLoader = yield* ConfigLoader;
  const env = yield* Env;
  const path = yield* Path.Path;
  const git = yield* Git;
  const config = yield* configLoader.load();
  const availableRules = config.rules.map((rule) => rule.binding.id).toSorted();
  for (const requested of options.rules) {
    if (!config.rulesById.has(requested))
      return yield* new DetectionError({ ruleId: requested, cause: new Error("Unknown binding") });
  }
  const activeRules = filterRules(config, options.rules);
  const scope: CollectResult["scope"] =
    options.all && options.files.length === 0 && options.rules.length === 0 ? "complete" : "partial";
  const requestedBase = options.base ?? config.base;

  if (activeRules.length === 0) {
    return {
      findings: [],
      sources: {},
      scannedFiles: [],
      noMatchingRules: true,
      availableRules,
      scope,
      base: requestedBase,
    };
  }

  const stateRules = activeRules.filter((rule): rule is StateRule => rule.lifecycle === "state");
  const changeRules = activeRules.filter((rule): rule is ChangeRule => rule.lifecycle === "change");
  const findings: FindingRecord[] = [];
  const sources = new Map<string, string>();
  // Both lifecycles read the same comparison; resolve it at most once per run.
  const changeSet = yield* Effect.cached(git.changeSet(requestedBase));
  const changedPaths =
    changeRules.length === 0
      ? git.changedFiles(requestedBase)
      : changeSet.pipe(
          Effect.map((change) => change.files.filter((file) => file.status !== "deleted").map((file) => file.path)),
        );

  if (stateRules.length > 0) {
    const repositoryScan = stateRules.some(
      (rule) =>
        rule.binding.dependencies?.length ||
        rule.detector.scan === "repository" ||
        (rule.detector.createOnce && rule.detector.scan !== "file"),
    );
    const files = yield* resolveFiles(
      {
        all: options.all || repositoryScan,
        baseRef: requestedBase,
        configIgnores: config.ignores.length ? [...config.ignores] : undefined,
        positionalFiles: !repositoryScan && options.files.length ? [...options.files] : undefined,
      },
      { changedFiles: () => changedPaths },
    );
    findings.push(...(yield* collectStateFindings(stateRules, files, undefined, sources)));
  }

  let selectedBase = requestedBase;
  if (changeRules.length > 0) {
    const change = yield* changeSet;
    selectedBase = change.baseline.ref;
    const explicitMatcher = options.files.length ? picomatch([...options.files]) : undefined;
    const ignoreMatcher = config.ignores.length ? picomatch([...config.ignores]) : undefined;

    for (const rule of changeRules) {
      const inScope = scopeMatcher(rule);
      const filteredChange = {
        ...change,
        files: change.files.filter(
          (file) =>
            inScope(file.path) &&
            (!ignoreMatcher || !ignoreMatcher(file.path)) &&
            (!explicitMatcher || explicitMatcher(file.path)),
        ),
      };
      if (filteredChange.files.length === 0) continue;
      for (const file of filteredChange.files)
        sources.set(file.path, file.after?.content ?? file.before?.content ?? "");
      const context = new ChangeRuleContextImpl(rule, filteredChange, (file) => path.resolve(env.cwd, file));
      yield* Effect.try({
        try: () => rule.detector.detect(context, rule.binding.options),
        catch: (cause) => new DetectionError({ ruleId: rule.binding.id, cause }),
      });
      findings.push(...context.findings);
    }
  }

  return {
    findings: sortFindings(findings),
    scannedFiles: [...sources.keys()].toSorted(),
    sources: Object.fromEntries(
      [...new Set(findings.map((finding) => finding.file))].map((file) => [file, sources.get(file) ?? ""]),
    ),
    noMatchingRules: false,
    availableRules: activeRules.map((rule) => rule.binding.id).toSorted(),
    scope,
    base: selectedBase,
  };
});
