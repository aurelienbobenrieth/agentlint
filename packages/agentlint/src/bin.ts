#!/usr/bin/env node
/** agentlint command line application. @module @since 0.2.0 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { formatCheckJsonl, formatCheckText } from "./cli/reporter.js";
import { Env } from "./config/env.js";
import { AcceptanceRecord } from "./domain/acceptance.js";
import { acceptHandler } from "./features/accept/handler.js";
import { AcceptCommand } from "./features/accept/request.js";
import { acceptancesHandler } from "./features/acceptances/handler.js";
import { AcceptancesCommand } from "./features/acceptances/request.js";
import { checkHandler } from "./features/check/handler.js";
import { CheckCommand } from "./features/check/request.js";
import { explainHandler } from "./features/explain/handler.js";
import { ExplainCommand } from "./features/explain/request.js";
import { initHandler } from "./features/init/handler.js";
import { InitCommand } from "./features/init/request.js";
import { proposeHandler } from "./features/propose/handler.js";
import { ProposeCommand } from "./features/propose/request.js";
import type { ReviewArtifact, ReviewMode, ReviewStatePayload } from "./features/review/contract.js";
import { buildReviewPayload } from "./features/review/handler.js";
import { runReviewSession } from "./features/review/server.js";
import { rulesListHandler, rulesScanHandler, rulesTestHandler } from "./features/rules/handler.js";
import { RulesListCommand, RulesScanCommand, RulesTestCommand } from "./features/rules/request.js";
import { AcceptanceStore } from "./shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "./shared/infrastructure/config-loader.js";
import { Git } from "./shared/infrastructure/git.js";
import { Parser } from "./shared/infrastructure/parser.js";
import { ProposalStore } from "./shared/infrastructure/proposal-store.js";
import { SelectorCache } from "./shared/infrastructure/selector-cache.js";

declare const __AGENTLINT_VERSION__: string;

interface ParsedFlags {
  readonly values: ReadonlyMap<string, string | true>;
  readonly positionals: ReadonlyArray<string>;
}

function parseFlags(args: ReadonlyArray<string>): ParsedFlags {
  const values = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument) continue;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const [inlineName, inlineValue] = argument.slice(2).split("=", 2);
    if (!inlineName) continue;
    if (inlineValue !== undefined) {
      values.set(inlineName, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(inlineName, next);
      index++;
    } else values.set(inlineName, true);
  }
  return { values, positionals };
}

const stringFlag = (flags: ParsedFlags, name: string): string | undefined => {
  const value = flags.values.get(name);
  return typeof value === "string" ? value : undefined;
};
const booleanFlag = (flags: ParsedFlags, name: string): boolean => flags.values.get(name) === true;
const ruleFlags = (flags: ParsedFlags): string[] =>
  (stringFlag(flags, "rule") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

function usage(): string {
  return [
    `agentlint v${__AGENTLINT_VERSION__}`,
    "Deterministic findings. Explicit judgment. A gate agents cannot hand-wave past.",
    "",
    "Usage:",
    "  agentlint check [files...] [--all] [--base ref] [--rule id] [--format text|jsonl]",
    "                  [--review-output path]",
    '  agentlint accept <selector> --reason "..." [--base ref]       agent authority',
    '  agentlint approve <selector> --reason "..." [--base ref]      human authority',
    '  agentlint propose <selector> --summary "..." [--diff-file path] [--base ref]',
    "  agentlint explain <rule-id|selector>",
    "  agentlint review [--base ref] [--mode review|calibration] [--from artifact.json]",
    "                   [--port number] [--no-open]",
    "  agentlint rules list [--files path]",
    "  agentlint rules test [--rule id]",
    "  agentlint rules scan [files...] [--rule id] [--base ref] [--review]",
    "  agentlint acceptances list",
    "  agentlint acceptances clean [--base ref]",
    "  agentlint acceptances import <decisions.jsonl> [--base ref]",
    "  agentlint init",
    "",
    "Exit codes: 0 gate open; 1 unresolved findings; 2 usage or configuration error.",
  ].join("\n");
}

const failUsage = (message?: string) =>
  Effect.gen(function* () {
    if (message) yield* Console.error(message);
    yield* Console.log(usage());
    (yield* Env).setExitCode(2);
  });

function reviewMode(value: string | undefined): ReviewMode | undefined {
  return value === "review" || value === "calibration" ? value : undefined;
}

function isReviewState(value: unknown): value is ReviewStatePayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    Array.isArray((value as { findings?: unknown }).findings)
  );
}

const readArtifact = Effect.fn("readArtifact")(function* (file: string) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(env.cwd, file);
  const raw = yield* fs.readFileString(absolute);
  const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
  const decoded = yield* Effect.try({
    try: () => decodeJson(raw),
    catch: (cause) => new Error("invalid JSON", { cause }),
  });
  const state =
    typeof decoded === "object" && decoded !== null && "state" in decoded
      ? (decoded as { state: unknown }).state
      : decoded;
  if (!isReviewState(state)) return yield* Effect.fail(new Error(`${file} is not an agentlint review artifact.`));
  return { state, source: absolute };
});

const writeReviewArtifact = Effect.fn("writeReviewArtifact")(function* (file: string, base?: string) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(env.cwd, file);
  const state = yield* buildReviewPayload({
    base,
    mode: "review",
    transport: "detached",
    source: path.basename(absolute),
  });
  const artifact: ReviewArtifact = { version: 1, state };
  yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
  yield* fs.writeFileString(absolute, `${JSON.stringify(artifact, null, 2)}\n`);
  return absolute;
});

const readAcceptanceRecords = Effect.fn("readAcceptanceRecords")(function* (file: string) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raw = yield* fs.readFileString(path.resolve(env.cwd, file));
  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(AcceptanceRecord));
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return decode(line);
      } catch (error) {
        throw new Error(
          `Invalid acceptance on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error,
          },
        );
      }
    });
});

const runCheck = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const flags = parseFlags(args);
    const format = stringFlag(flags, "format") ?? "text";
    if (format !== "text" && format !== "jsonl") return yield* failUsage(`Unknown output format: ${format}`);
    const command = new CheckCommand({
      all: booleanFlag(flags, "all"),
      rules: ruleFlags(flags),
      base: stringFlag(flags, "base"),
      files: [...flags.positionals],
      format,
    });
    const result = yield* checkHandler(command);
    if (result.noMatchingRules) {
      yield* Console.error(`No matching rules. Available: ${result.availableRules.join(", ") || "none"}`);
      (yield* Env).setExitCode(2);
      return;
    }
    const config = yield* (yield* ConfigLoader).load();
    const output =
      format === "jsonl"
        ? formatCheckJsonl(result.unresolved, config, result.lineage)
        : yield* formatCheckText(result.unresolved, config, __AGENTLINT_VERSION__, result.lineage);
    if (output) yield* Console.log(output);
    if (format === "text" && result.accepted.length) {
      yield* Console.log(
        `${result.accepted.length} accepted finding${result.accepted.length === 1 ? "" : "s"} hidden.`,
      );
    }
    if (result.staleCount) {
      yield* Console.log(`${result.staleCount} stale acceptance${result.staleCount === 1 ? "" : "s"} removed.`);
    }
    const artifactPath = stringFlag(flags, "review-output");
    if (artifactPath) yield* Console.log(`Review artifact: ${yield* writeReviewArtifact(artifactPath, command.base)}`);
    (yield* Env).setExitCode(result.exitCode);
  });

const runDecision = (args: ReadonlyArray<string>, authority: "agent" | "human") =>
  Effect.gen(function* () {
    const flags = parseFlags(args);
    const result = yield* acceptHandler(
      new AcceptCommand({
        selector: flags.positionals[0],
        reason: stringFlag(flags, "reason"),
        authority,
        base: stringFlag(flags, "base"),
      }),
    );
    yield* Console.log(result.message);
    (yield* Env).setExitCode(result.exitCode);
  });

const runPropose = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const flags = parseFlags(args);
    const diffFile = stringFlag(flags, "diff-file");
    const env = yield* Env;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const diff = diffFile ? yield* fs.readFileString(path.resolve(env.cwd, diffFile)) : stringFlag(flags, "diff");
    const result = yield* proposeHandler(
      new ProposeCommand({
        selector: flags.positionals[0],
        summary: stringFlag(flags, "summary"),
        diff,
        base: stringFlag(flags, "base"),
      }),
    );
    yield* Console.log(result.message);
    env.setExitCode(result.exitCode);
  });

const runExplain = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const selector = args[0];
    if (!selector) return yield* failUsage("Missing a rule or finding selector.");
    const result = yield* explainHandler(new ExplainCommand({ selector }));
    yield* Console.log(result.output);
    if (!result.found) (yield* Env).setExitCode(2);
  });

const runReview = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const flags = parseFlags(args);
    const requestedMode = stringFlag(flags, "mode");
    const mode = reviewMode(requestedMode) ?? "review";
    if (requestedMode && !reviewMode(requestedMode)) return yield* failUsage(`Unknown review mode: ${requestedMode}`);
    const portText = stringFlag(flags, "port");
    const port = portText ? Number(portText) : 0;
    if (!Number.isInteger(port) || port < 0 || port > 65_535) return yield* failUsage("--port must be 0..65535.");
    const from = stringFlag(flags, "from");
    const artifact = from ? yield* readArtifact(from) : undefined;
    const result = yield* runReviewSession({
      base: stringFlag(flags, "base"),
      port,
      open: !booleanFlag(flags, "no-open"),
      mode: artifact?.state.mode ?? mode,
      artifact: artifact?.state,
      artifactSource: artifact?.source,
    });
    yield* Console.log(`Review finished: ${result.summary}`);
    if (result.feedback) yield* Console.log(result.feedback);
  });

const runRules = (subcommand: string | undefined, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const flags = parseFlags(args);
    if (subcommand === "list") {
      const result = yield* rulesListHandler(new RulesListCommand({ file: stringFlag(flags, "files") }));
      if (!result.rules.length) return yield* Console.log("No rules configured.");
      for (const rule of result.rules) {
        yield* Console.log(
          `${rule.enabled ? "on " : "off"} ${rule.id} [${rule.lifecycle}/${rule.authority}] ${rule.title}\n  ${rule.standardId} · ${rule.detector}`,
        );
      }
      return;
    }
    if (subcommand === "test") {
      const result = yield* rulesTestHandler(new RulesTestCommand({ rules: ruleFlags(flags) }));
      yield* Console.log(result.message);
      (yield* Env).setExitCode(result.exitCode);
      return;
    }
    if (subcommand === "scan") {
      const base = stringFlag(flags, "base");
      const result = yield* rulesScanHandler(
        new RulesScanCommand({ rules: ruleFlags(flags), base, files: [...flags.positionals] }),
      );
      yield* Console.log(result.fixtureMessage);
      if (result.exitCode !== 0) {
        (yield* Env).setExitCode(result.exitCode);
        return;
      }
      yield* Console.log(`${result.findings.length} calibration candidate${result.findings.length === 1 ? "" : "s"}.`);
      if (booleanFlag(flags, "review")) {
        yield* runReviewSession({ base, port: 0, open: true, mode: "calibration" });
      }
      return;
    }
    return yield* failUsage("Use `agentlint rules list`, `rules test`, or `rules scan`.");
  });

const runAcceptances = (subcommand: string | undefined, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (subcommand !== "list" && subcommand !== "clean" && subcommand !== "import") {
      return yield* failUsage("Use `agentlint acceptances list`, `acceptances clean`, or `acceptances import`.");
    }
    const flags = parseFlags(args);
    const imported =
      subcommand === "import" && flags.positionals[0] ? yield* readAcceptanceRecords(flags.positionals[0]) : [];
    if (subcommand === "import" && !flags.positionals[0]) return yield* failUsage("Missing decisions JSONL file.");
    const result = yield* acceptancesHandler(
      new AcceptancesCommand({ action: subcommand, base: stringFlag(flags, "base"), imported }),
    );
    if (subcommand === "clean") yield* Console.log(`Removed ${result.removedCount} stale acceptance(s).`);
    if (subcommand === "import") {
      yield* Console.log(`Imported ${result.importedCount} acceptance(s).`);
      if (result.rejectedCount) {
        yield* Console.error(
          `Rejected ${result.rejectedCount} decision(s): the finding changed, disappeared, or requires different authority.`,
        );
      }
    }
    if (!result.records.length) yield* Console.log("No active acceptances.");
    for (const record of result.records) {
      yield* Console.log(
        `${record.source.bindingId} ${record.authority} ${record.fingerprint.digest.slice(0, 12)} ${record.reason}`,
      );
    }
    (yield* Env).setExitCode(result.exitCode);
  });

const program = Effect.gen(function* () {
  const env = yield* Env;
  const [command, subcommand, ...rest] = env.argv;
  switch (command) {
    case "check":
      return yield* runCheck(env.argv.slice(1));
    case "accept":
      return yield* runDecision(env.argv.slice(1), "agent");
    case "approve":
      return yield* runDecision(env.argv.slice(1), "human");
    case "propose":
      return yield* runPropose(env.argv.slice(1));
    case "explain":
      return yield* runExplain(env.argv.slice(1));
    case "review":
      return yield* runReview(env.argv.slice(1));
    case "rules":
      return yield* runRules(subcommand, rest);
    case "acceptances":
      return yield* runAcceptances(subcommand, rest);
    case "init": {
      const result = yield* initHandler(new InitCommand({}));
      yield* Console.log(result.message);
      return;
    }
    case undefined:
    case "--help":
    case "-h":
      yield* Console.log(usage());
      return;
    case "--version":
    case "-v":
      yield* Console.log(__AGENTLINT_VERSION__);
      return;
    default:
      return yield* failUsage(`Unknown command: ${command}`);
  }
}).pipe(
  Effect.catch((error: unknown) =>
    Effect.gen(function* () {
      const message = error instanceof Error ? error.message : String(error);
      yield* Console.error(`agentlint: ${message}`);
      (yield* Env).setExitCode(2);
    }),
  ),
);

const AppLayer = Layer.mergeAll(
  ConfigLoader.layer,
  Parser.layer,
  Git.layer,
  AcceptanceStore.layer,
  ProposalStore.layer,
  SelectorCache.layer,
).pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(Env.layer));

NodeRuntime.runMain(program.pipe(Effect.provide(AppLayer)) as Effect.Effect<void>);
