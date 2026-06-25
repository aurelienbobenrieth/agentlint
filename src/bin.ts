#!/usr/bin/env node
/**
 * CLI entry point for `agentlint`.
 *
 * @module
 * @since 0.2.0
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, Layer } from "effect";
import { formatCheckJsonl, formatCheckText } from "./cli/reporter.js";
import { Env } from "./config/env.js";
import { normalizeConfig } from "./domain/config.js";
import { checkHandler } from "./features/check/handler.js";
import { CheckCommand } from "./features/check/request.js";
import { explainHandler } from "./features/explain/handler.js";
import { ExplainCommand } from "./features/explain/request.js";
import { initHandler } from "./features/init/handler.js";
import { InitCommand } from "./features/init/request.js";
import { ledgerGcHandler, ledgerListHandler } from "./features/ledger/handler.js";
import { LedgerGcCommand, LedgerListCommand } from "./features/ledger/request.js";
import { resolveHandler } from "./features/resolve/handler.js";
import { ResolveCommand } from "./features/resolve/request.js";
import { rulesListHandler } from "./features/rules/handler.js";
import { RulesListCommand } from "./features/rules/request.js";
import { ConfigLoader } from "./shared/infrastructure/config-loader.js";
import { Git } from "./shared/infrastructure/git.js";
import { LedgerStore } from "./shared/infrastructure/ledger-store.js";
import { Parser } from "./shared/infrastructure/parser.js";
import { SelectorCache } from "./shared/infrastructure/selector-cache.js";

declare const __AGENTLINT_VERSION__: string;

type CheckFormat = "text" | "jsonl";

interface ParsedFlags {
  readonly values: Map<string, string | true>;
  readonly positionals: ReadonlyArray<string>;
}

function parseFlags(args: ReadonlyArray<string>): ParsedFlags {
  const values = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const name = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(name, next);
      index++;
    } else {
      values.set(name, true);
    }
  }

  return { values, positionals };
}

function flagString(flags: ParsedFlags, name: string): string | undefined {
  const value = flags.values.get(name);
  return typeof value === "string" ? value : undefined;
}

function flagBoolean(flags: ParsedFlags, name: string): boolean {
  return flags.values.get(name) === true;
}

function parseRuleFilter(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    : [];
}

function parseResolveStatus(flags: ParsedFlags): "accepted" | "deferred" | "no_fix" | undefined {
  const statuses = [
    flagBoolean(flags, "accept") ? "accepted" : undefined,
    flagBoolean(flags, "defer") ? "deferred" : undefined,
    flagBoolean(flags, "no-fix") ? "no_fix" : undefined,
  ].filter((status): status is "accepted" | "deferred" | "no_fix" => status !== undefined);

  return statuses.length === 1 ? statuses[0] : undefined;
}

function usage(): string {
  return [
    `agentlint v${__AGENTLINT_VERSION__}`,
    "",
    "Commands:",
    "  agentlint check [files...] [--format text|jsonl] [--all] [--base main] [--rule id] [--ci]",
    "  agentlint explain <rule-id|selector>",
    '  agentlint resolve <selector> --accept|--defer|--no-fix --reason "..."',
    "  agentlint rules list [--files path]",
    "  agentlint ledger list [--rule id]",
    "  agentlint ledger gc [--rule id] [--dry-run] [--write]",
    "  agentlint init",
  ].join("\n");
}

const runCheck = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const flags = parseFlags(args);
    const format = (flagString(flags, "format") ?? "text") as CheckFormat;
    const result = yield* checkHandler(
      new CheckCommand({
        all: flagBoolean(flags, "all"),
        rules: parseRuleFilter(flagString(flags, "rule")),
        base: flagString(flags, "base"),
        files: [...flags.positionals],
        format,
        ci: flagBoolean(flags, "ci"),
      }),
    );

    if (result.noMatchingRules) {
      yield* Console.log(`No matching rules found. Available: ${result.availableRules.join(", ")}`);
      const env = yield* Env;
      env.setExitCode(2);
      return;
    }

    const configLoader = yield* ConfigLoader;
    const config = normalizeConfig(yield* configLoader.load());
    const output =
      format === "jsonl"
        ? formatCheckJsonl(result.displayedFindings, config)
        : yield* formatCheckText(result.displayedFindings, config, {
            version: __AGENTLINT_VERSION__,
            ci: result.deferredCount > 0 && flagBoolean(flags, "ci"),
          });

    if (output.length > 0) {
      yield* Console.log(output);
    }

    if (format === "text") {
      const summary: string[] = [];
      if (result.resolvedCount > 0) summary.push(`${result.resolvedCount} resolved hidden`);
      if (result.deferredCount > 0) summary.push(`${result.deferredCount} deferred`);
      if (result.staleCount > 0) summary.push(`${result.staleCount} stale ledger record(s)`);
      if (summary.length > 0) {
        yield* Console.log(summary.join("; "));
      }
    }

    const env = yield* Env;
    env.setExitCode(result.exitCode);
  });

const runRulesList = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const flags = parseFlags(args);
    const result = yield* rulesListHandler(new RulesListCommand({ file: flagString(flags, "files") }));
    if (result.rules.length === 0) {
      yield* Console.log("No rules registered.");
      return;
    }

    for (const rule of result.rules) {
      yield* Console.log(
        `${rule.enabled ? "on " : "off"} ${rule.id} [${rule.persistence}] - ${rule.description}\n  ${rule.standard}`,
      );
    }
  });

const runExplain = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const selector = args[0];
    if (!selector) {
      yield* Console.log("Usage: agentlint explain <rule-id|selector>");
      const env = yield* Env;
      env.setExitCode(2);
      return;
    }
    const result = yield* explainHandler(new ExplainCommand({ selector }));
    yield* Console.log(result.output);
    if (!result.found) {
      const env = yield* Env;
      env.setExitCode(2);
    }
  });

const runResolve = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const flags = parseFlags(args);
    const result = yield* resolveHandler(
      new ResolveCommand({
        selector: flags.positionals[0],
        status: parseResolveStatus(flags),
        reason: flagString(flags, "reason"),
        actor: flagString(flags, "actor"),
        interactive: flagBoolean(flags, "interactive"),
      }),
    );
    yield* Console.log(result.message);
    const env = yield* Env;
    env.setExitCode(result.exitCode);
  });

const runLedger = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const subcommand = args[0];
    const flags = parseFlags(args.slice(1));
    const result =
      subcommand === "list"
        ? yield* ledgerListHandler(new LedgerListCommand({ rule: flagString(flags, "rule") }))
        : subcommand === "gc"
          ? yield* ledgerGcHandler(
              new LedgerGcCommand({ rule: flagString(flags, "rule"), write: flagBoolean(flags, "write") }),
            )
          : undefined;

    if (!result) {
      yield* Console.log("Usage: agentlint ledger list|gc");
      const env = yield* Env;
      env.setExitCode(2);
      return;
    }

    yield* Console.log(result.message);
    const env = yield* Env;
    env.setExitCode(result.exitCode);
  });

const runInit = Effect.gen(function* () {
  const result = yield* initHandler(new InitCommand({}));
  yield* Console.log(result.message);
});

const program = Effect.gen(function* () {
  const env = yield* Env;
  const [command, subcommand, ...rest] = env.argv;

  switch (command) {
    case "check":
      return yield* runCheck(env.argv.slice(1));
    case "explain":
      return yield* runExplain(env.argv.slice(1));
    case "resolve":
      return yield* runResolve(env.argv.slice(1));
    case "rules":
      if (subcommand === "list") return yield* runRulesList(rest);
      yield* Console.log("Usage: agentlint rules list [--files path]");
      env.setExitCode(2);
      return;
    case "ledger":
      return yield* runLedger(env.argv.slice(1));
    case "init":
      return yield* runInit;
    case undefined:
    case "--help":
    case "-h":
      yield* Console.log(usage());
      return;
    default:
      yield* Console.log(usage());
      env.setExitCode(2);
  }
}).pipe(
  Effect.catch((error: unknown) =>
    Effect.gen(function* () {
      const env = yield* Env;
      const message =
        typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
      yield* Console.log(`agentlint error: ${message}`);
      env.setExitCode(2);
    }),
  ),
);

const AppLayer = Layer.mergeAll(
  ConfigLoader.layer,
  Parser.layer,
  Git.layer,
  LedgerStore.layer,
  SelectorCache.layer,
).pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(Env.layer));

const runnable = program.pipe(Effect.provide(AppLayer)) as Effect.Effect<void>;

NodeRuntime.runMain(runnable);
