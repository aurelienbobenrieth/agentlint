/**
 * Flag collection pipeline — shared between `check` and `review`.
 *
 * @module
 * @since 0.1.0
 */

import { Effect, FileSystem, Path, Schema } from "effect";
import picomatch from "picomatch";
import { Env } from "../../config/env.js";
import { FlagRecord } from "../../domain/flag.js";
import type { AgentReviewRule, Visitors } from "../../domain/rule.js";
import { RuleContextImpl } from "../../domain/rule-context.js";
import { ConfigLoader } from "../infrastructure/config-loader.js";
import { resolveFiles } from "./file-resolver.js";
import { Git } from "../infrastructure/git.js";
import { Parser } from "../infrastructure/parser.js";
import { walkFile } from "./tree-walker.js";
import { grammarForExtension } from "./language-map.js";

/**
 * @since 0.1.0
 * @category models
 */
export const CollectResult = Schema.Struct({
  /** Collected flags. */
  flags: Schema.Array(FlagRecord),
  /** `true` when the `--rule` filter matched no registered rules. */
  noMatchingRules: Schema.Boolean,
});

/** @since 0.1.0 */
export type CollectResult = Schema.Schema.Type<typeof CollectResult>;

/**
 * @since 0.1.0
 * @category models
 */
export const CollectOptions = Schema.Struct({
  /** When `true`, scan all files instead of only git-changed files. */
  all: Schema.Boolean,
  /** Rule name filter. Empty array means "run all rules". */
  rules: Schema.Array(Schema.String),
  /** When `true`, suppress instruction and hint blocks in output. */
  dryRun: Schema.Boolean,
  /** Git ref to diff against. `undefined` means auto-detect. */
  base: Schema.UndefinedOr(Schema.String),
  /** Explicit file paths from positional CLI arguments. */
  files: Schema.Array(Schema.String),
});

/** @since 0.1.0 */
export type CollectOptions = Schema.Schema.Type<typeof CollectOptions>;

/** @since 0.1.0 */
export const collectFlags = Effect.fn("collectFlags")(function* (
  options: CollectOptions,
): Generator<any, CollectResult> {
  const configLoader = yield* ConfigLoader;
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const gitService = yield* Git;
  const parserService = yield* Parser;

  const config = yield* configLoader.load();

  let activeRules: Array<[string, AgentReviewRule]> = Object.entries(config.rules);
  if (options.rules.length > 0) {
    activeRules = activeRules.filter(([name]) => options.rules.includes(name));
    if (activeRules.length === 0) return { flags: [], noMatchingRules: true };
  }

  const includePatterns = config.include ? [...config.include] : undefined;
  const ignorePatterns = config.ignore ? [...config.ignore] : undefined;

  const files = yield* resolveFiles(
    {
      all: options.all,
      baseRef: options.base,
      configInclude: includePatterns,
      configIgnore: ignorePatterns,
      positionalFiles: options.files.length > 0 ? [...options.files] : undefined,
    },
    gitService,
  );

  if (files.length === 0) return { flags: [], noMatchingRules: false };

  const ruleEntries: Array<{
    name: string;
    rule: AgentReviewRule;
    context: RuleContextImpl;
    visitors: Visitors;
  }> = [];

  for (const [name, rule] of activeRules) {
    const context = new RuleContextImpl(name);
    const visitors = rule.createOnce(context);
    ruleEntries.push({ name, rule, context, visitors });
  }

  const allFlags: FlagRecord[] = [];

  for (const file of files) {
    const ext = path.extname(file).slice(1);
    const absPath = path.resolve(env.cwd, file);

    const applicableRules = ruleEntries.filter((entry) => {
      if (!entry.rule.meta.languages.includes(ext)) return false;

      if (entry.rule.meta.include && entry.rule.meta.include.length > 0) {
        const matcher = picomatch([...entry.rule.meta.include]);
        if (!matcher(file)) return false;
      }

      if (entry.rule.meta.ignore && entry.rule.meta.ignore.length > 0) {
        const matcher = picomatch([...entry.rule.meta.ignore]);
        if (matcher(file)) return false;
      }

      return true;
    });

    if (applicableRules.length === 0) continue;

    const sourceResult = yield* fs.readFileString(absPath).pipe(Effect.result);
    if (sourceResult._tag === "Failure") continue;
    const source = sourceResult.success;

    const grammar = grammarForExtension(ext);
    if (!grammar) continue;

    const tree = yield* parserService.parse(source, grammar);

    const rulesForFile: Array<{
      ruleName: string;
      context: RuleContextImpl;
      visitors: Visitors;
    }> = [];

    for (const entry of applicableRules) {
      entry.context.setFile(absPath, source);
      const beforeResult = entry.visitors.before?.(absPath);
      if (beforeResult === false) continue;
      rulesForFile.push({
        ruleName: entry.name,
        context: entry.context,
        visitors: entry.visitors,
      });
    }

    if (rulesForFile.length === 0) continue;

    const fileFlags = walkFile(tree, rulesForFile);
    allFlags.push(...fileFlags);
  }

  for (const entry of ruleEntries) {
    entry.visitors.after?.();
  }

  return { flags: allFlags, noMatchingRules: false };
});
