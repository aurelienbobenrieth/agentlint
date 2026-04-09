#!/usr/bin/env node
/**
 * CLI entry point for `agentlint`.
 *
 * Thin adapter that translates CLI arguments into feature commands,
 * dispatches to the appropriate handler, and formats the result
 * for terminal output.
 *
 * @module
 * @since 0.1.0
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, HashMap, Layer, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { checkHandler } from "./features/check/handler.js";
import { CheckCommand } from "./features/check/request.js";
import { initHandler } from "./features/init/handler.js";
import { InitCommand } from "./features/init/request.js";
import { listHandler } from "./features/list/handler.js";
import { ListCommand } from "./features/list/request.js";
import { reviewHandler } from "./features/review/handler.js";
import { ReviewCommand } from "./features/review/request.js";
import { Env } from "./config/env.js";
import { ConfigLoader } from "./shared/infrastructure/config-loader.js";
import { Git } from "./shared/infrastructure/git.js";
import { Parser } from "./shared/infrastructure/parser.js";
import { StateStore } from "./shared/infrastructure/state-store.js";
import { formatReport } from "./cli/reporter.js";
import type { RuleMeta } from "./domain/rule.js";

declare const __AGENTLINT_VERSION__: string;

/** The `check` subcommand — scans files and outputs a report. */
const check = Command.make(
  "check",
  {
    files: Argument.string("files").pipe(
      Argument.withDescription("Specific files or globs to scan"),
      Argument.variadic(),
    ),
    all: Flag.boolean("all").pipe(Flag.withAlias("a"), Flag.withDescription("Scan all files (not just git diff)")),
    rule: Flag.string("rule").pipe(
      Flag.withAlias("r"),
      Flag.withDescription("Run only this rule (comma-separated for multiple)"),
      Flag.optional,
    ),
    dryRun: Flag.boolean("dry-run").pipe(
      Flag.withAlias("d"),
      Flag.withDescription("Show counts only, no instruction blocks"),
    ),
    base: Flag.string("base").pipe(Flag.withDescription("Git ref to diff against"), Flag.optional),
  },
  (config) => {
    const ruleFilter = Option.match(config.rule, {
      onNone: () => [] as ReadonlyArray<string>,
      onSome: (r: string) => r.split(",").map((s) => s.trim()),
    });
    const baseRef = Option.match(config.base, {
      onNone: () => undefined,
      onSome: (b: string) => b,
    });

    return Effect.gen(function* () {
      const env = yield* Env;
      const result = yield* checkHandler(
        new CheckCommand({
          all: config.all,
          rules: ruleFilter,
          dryRun: config.dryRun,
          base: baseRef,
          files: config.files,
        }),
      );

      if (result.noMatchingRules) {
        yield* Console.log(`No matching rules found. Available: ${result.availableRules.join(", ")}`);
        return;
      }

      if (result.totalFlags === 0) {
        yield* Console.log(`agentlint v${__AGENTLINT_VERSION__} - no rules triggered.`);
        return;
      }

      const configLoader = yield* ConfigLoader;
      const cfg = yield* configLoader.load();
      const rulesMeta: HashMap.HashMap<string, RuleMeta> = HashMap.fromIterable(
        Object.entries(cfg.rules).map(([name, rule]) => [name, rule.meta] as const),
      );

      const output = yield* formatReport(result.flags, rulesMeta, {
        dryRun: config.dryRun,
        version: __AGENTLINT_VERSION__,
      });

      yield* Console.log(output);

      if (result.filteredCount > 0) {
        yield* Console.log(
          `  (${result.filteredCount} reviewed flag(s) hidden — run agentlint review --reset to clear)`,
        );
      }

      if (result.flags.length > 0) {
        env.setExitCode(1);
      }
    });
  },
).pipe(Command.withDescription("Scan files and output report for AI agents"));

/** The `list` subcommand — prints all registered rules. */
const list = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const result = yield* listHandler(new ListCommand({}));

    if (result.rules.length === 0) {
      yield* Console.log("No rules registered.");
      return;
    }

    yield* Console.log(`${result.rules.length} rule(s) registered:\n`);

    for (const rule of result.rules) {
      const langs = rule.languages.join(", ");
      yield* Console.log(`  ${rule.name}`);
      yield* Console.log(`    ${rule.description}`);
      yield* Console.log(`    Languages: ${langs}`);
      if (rule.include) {
        yield* Console.log(`    Include: ${rule.include.join(", ")}`);
      }
      if (rule.ignore) {
        yield* Console.log(`    Ignore: ${rule.ignore.join(", ")}`);
      }
      yield* Console.log();
    }
  }),
).pipe(Command.withDescription("List all registered rules"));

/** The `init` subcommand — scaffolds a starter config file. */
const init = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const result = yield* initHandler(new InitCommand({}));
    yield* Console.log(result.message);
  }),
).pipe(Command.withDescription("Create agentlint.config.ts and set up agent skill discovery"));

/** The `review` subcommand — manage reviewed-flag state. */
const review = Command.make(
  "review",
  {
    hashes: Argument.string("hashes").pipe(
      Argument.withDescription("Flag hashes to mark as reviewed"),
      Argument.variadic(),
    ),
    all: Flag.boolean("all").pipe(Flag.withAlias("a"), Flag.withDescription("Mark all current flags as reviewed")),
    reset: Flag.boolean("reset").pipe(Flag.withDescription("Wipe the state file")),
  },
  (config) =>
    Effect.gen(function* () {
      const result = yield* reviewHandler(
        new ReviewCommand({
          hashes: config.hashes,
          all: config.all,
          reset: config.reset,
        }),
      );
      yield* Console.log(result.message);
    }),
).pipe(Command.withDescription("Mark flags as reviewed (filters them from check output)"));

const agentlint = Command.make("agentlint").pipe(
  Command.withDescription("Deterministic linting for AI agents"),
  Command.withSubcommands([check, list, init, review]),
);

const AppLayer = Layer.mergeAll(ConfigLoader.layer, Parser.layer, Git.layer, StateStore.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(Env.layer),
);

// The CLI framework uses `unknown` for aggregated service requirements,
// which doesn't fully resolve via `Effect.provide`. Cast to satisfy
// `NodeRuntime.runMain`'s `never` requirement constraint.
const program = Command.run(agentlint, { version: __AGENTLINT_VERSION__ }).pipe(
  Effect.provide(AppLayer),
) as Effect.Effect<void>;

NodeRuntime.runMain(program);
