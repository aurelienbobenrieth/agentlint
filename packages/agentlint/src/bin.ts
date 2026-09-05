#!/usr/bin/env node
/** agentlint command line application. @module @since 0.2.0 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, FileSystem, Layer, Option, Path, Result, Schema } from "effect";
import { Argument, CliError, CliOutput, Command, Flag } from "effect/unstable/cli";
import { ruleIds } from "./cli/flags.js";
import { formatCheckJsonl, formatCheckText } from "./cli/reporter.js";
import { Env } from "./config/env.js";
import { acceptHandler } from "./features/accept/handler.js";
import { AcceptCommand } from "./features/accept/request.js";
import { acceptancesHandler } from "./features/acceptances/handler.js";
import { AcceptancesCommand, type AcceptancesResult } from "./features/acceptances/request.js";
import { checkHandler } from "./features/check/handler.js";
import { CheckCommand, type CheckResult } from "./features/check/request.js";
import { explainHandler } from "./features/explain/handler.js";
import { ExplainCommand } from "./features/explain/request.js";
import { initHandler } from "./features/init/handler.js";
import { InitCommand } from "./features/init/request.js";
import { prHandler } from "./features/pr/handler.js";
import { PrCommand } from "./features/pr/request.js";
import { proposeHandler } from "./features/propose/handler.js";
import { ProposeCommand } from "./features/propose/request.js";
import { ReviewArtifact } from "./features/review/contract.js";
import { buildReviewPayload } from "./features/review/handler.js";
import { runReviewSession } from "./features/review/server.js";
import { rulesListHandler, rulesScanHandler, rulesTestHandler } from "./features/rules/handler.js";
import { RulesListCommand, RulesScanCommand, RulesTestCommand } from "./features/rules/request.js";
import { AcceptanceStore, parseDecisions } from "./shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "./shared/infrastructure/config-loader.js";
import { Gh } from "./shared/infrastructure/gh.js";
import { Git } from "./shared/infrastructure/git.js";
import { Parser } from "./shared/infrastructure/parser.js";
import { ProposalStore } from "./shared/infrastructure/proposal-store.js";
import { SelectorCache } from "./shared/infrastructure/selector-cache.js";

declare const __AGENTLINT_VERSION__: string;

const TAGLINE = "Deterministic findings. Explicit judgment. Repository-owned review decisions.";
const EXIT_CODES = "Exit codes: 0 gate open; 1 unresolved findings; 2 usage or configuration error.";

// ---------------------------------------------------------------------------
// Shared flags and arguments
// ---------------------------------------------------------------------------

const optionalString = (name: string, metavar: string, description: string) =>
  Flag.string(name).pipe(
    Flag.withMetavar(metavar),
    Flag.withDescription(description),
    Flag.optional,
    Flag.map(Option.getOrUndefined),
  );

const baseFlag = optionalString("base", "ref", "Git ref used as the change baseline (merge base)");

const ruleFlag = Flag.string("rule").pipe(
  Flag.withMetavar("id"),
  Flag.withDescription("Restrict to a rule id; repeat or comma-separate for several"),
  Flag.atLeast(0),
  Flag.map(ruleIds),
);

const filesArgument = Argument.string("files").pipe(
  Argument.withDescription("Files or directories to inspect"),
  Argument.variadic(),
);

const selectorArgument = Argument.string("selector").pipe(
  Argument.withDescription("Finding number from the last check or a full finding key"),
);

const portFlag = Flag.integer("port").pipe(
  Flag.withDescription("Local server port (0 picks a free port)"),
  Flag.withDefault(0),
  Flag.filter(
    (port) => port >= 0 && port <= 65_535,
    () => "--port must be 0..65535.",
  ),
);

const openFlag = Flag.boolean("open").pipe(
  Flag.withDescription("Open the browser; pass --no-open to only print the URL"),
  Flag.withDefault(true),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const readArtifact = Effect.fn("readArtifact")(function* (file: string) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(env.cwd, file);
  const raw = yield* fs.readFileString(absolute);
  const artifact = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ReviewArtifact))(raw).pipe(
    Effect.mapError((cause) => new Error(`${file} is not an agentlint review artifact: ${cause.message}`, { cause })),
  );
  return { state: artifact.state, source: absolute };
});

const writeReviewArtifact = Effect.fn("writeReviewArtifact")(function* (
  file: string,
  check: CheckResult,
  base?: string,
) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(env.cwd, file);
  const state = yield* buildReviewPayload({
    check,
    base,
    mode: "review",
    transport: "detached",
    source: path.basename(absolute),
  });
  const artifact: ReviewArtifact = { version: 2, state };
  yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
  yield* fs.writeFileString(absolute, `${JSON.stringify(artifact, null, 2)}\n`);
  return absolute;
});

const readAcceptanceRecords = Effect.fn("readAcceptanceRecords")(function* (file: string) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raw = yield* fs.readFileString(path.resolve(env.cwd, file));
  return yield* Effect.try(() => parseDecisions(raw));
});

const setExitCode = (code: number) => Effect.map(Env, (env) => env.setExitCode(code));

const openReviewSession = Effect.fn("openReviewSession")(function* (options: Parameters<typeof runReviewSession>[0]) {
  const result = yield* runReviewSession(options);
  yield* Console.log(`Review finished: ${result.summary}`);
  if (result.feedback) yield* Console.log(result.feedback);
});

const printAcceptances = Effect.fn("printAcceptances")(function* (result: AcceptancesResult) {
  if (!result.records.length) yield* Console.log("No active acceptances.");
  for (const record of result.records) {
    yield* Console.log(
      `${record.source.bindingId} ${record.authority} ${record.fingerprint.digest.slice(0, 12)} ${record.reason}`,
    );
  }
  yield* setExitCode(result.exitCode);
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const check = Command.make(
  "check",
  {
    files: filesArgument,
    all: Flag.boolean("all").pipe(
      Flag.withDescription("Inspect the whole repository instead of the changed files"),
      Flag.withDefault(false),
    ),
    base: baseFlag,
    rules: ruleFlag,
    format: Flag.choice("format", ["text", "jsonl"]).pipe(
      Flag.withDescription("Output format"),
      Flag.withDefault("text"),
    ),
    reviewOutput: optionalString("review-output", "path", "Write a detached review artifact to this path"),
  },
  Effect.fn("check")(function* ({ files, all, base, rules, format, reviewOutput }) {
    const command = new CheckCommand({ all, rules, base, files: [...files], format });
    const result = yield* checkHandler(command);
    if (result.noMatchingRules) {
      yield* Console.error(`No matching rules. Available: ${result.availableRules.join(", ") || "none"}`);
      return yield* setExitCode(2);
    }
    const config = yield* (yield* ConfigLoader).load();
    const output =
      format === "jsonl"
        ? formatCheckJsonl(result.unresolved, config, result.lineage)
        : yield* formatCheckText(result.unresolved, config, __AGENTLINT_VERSION__, result.lineage);
    if (output) yield* Console.log(output);
    if (format === "text")
      yield* Console.log(
        `Coverage: ${result.scope}; ${result.scannedFiles.length} files; ${result.availableRules.length} executed bindings. ${result.scope === "partial" ? "Run check --all for a complete checkpoint." : "Every current finding in this scope requires a compatible decision."}`,
      );
    if (format === "text" && result.accepted.length) {
      yield* Console.log(
        `${result.accepted.length} accepted finding${result.accepted.length === 1 ? "" : "s"} hidden.`,
      );
    }
    if (result.staleCount) {
      yield* Console.log(`${result.staleCount} stale acceptance${result.staleCount === 1 ? "" : "s"} removed.`);
    }
    if (reviewOutput) yield* Console.log(`Review artifact: ${yield* writeReviewArtifact(reviewOutput, result, base)}`);
    yield* setExitCode(result.exitCode);
  }),
).pipe(Command.withDescription("Run the gate: report unresolved findings and exit 1 while any remain"));

const decisionCommand = (name: "accept" | "approve", authority: "agent" | "human", description: string) =>
  Command.make(
    name,
    {
      selector: selectorArgument,
      reason: Flag.string("reason").pipe(Flag.withDescription("Why this finding satisfies its standard")),
      base: baseFlag,
    },
    Effect.fn(name)(function* ({ selector, reason, base }) {
      const result = yield* acceptHandler(new AcceptCommand({ selector, reason, authority, base }));
      yield* Console.log(result.message);
      yield* setExitCode(result.exitCode);
    }),
  ).pipe(Command.withDescription(description));

const accept = decisionCommand("accept", "agent", "Record an acceptance with agent authority");
const approve = decisionCommand("approve", "human", "Record an acceptance with human authority");

const propose = Command.make(
  "propose",
  {
    selector: selectorArgument,
    summary: Flag.string("summary").pipe(Flag.withDescription("What the agent did or suggests for this finding")),
    diffFile: optionalString("diff-file", "path", "Attach the unified diff stored in this file"),
    base: baseFlag,
  },
  Effect.fn("propose")(function* ({ selector, summary, diffFile, base }) {
    const env = yield* Env;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const diff = diffFile ? yield* fs.readFileString(path.resolve(env.cwd, diffFile)) : undefined;
    const result = yield* proposeHandler(new ProposeCommand({ selector, summary, diff, base }));
    yield* Console.log(result.message);
    yield* setExitCode(result.exitCode);
  }),
).pipe(Command.withDescription("Attach agent work to a finding it cannot accept"));

const explain = Command.make(
  "explain",
  {
    selector: Argument.string("rule-id|selector").pipe(
      Argument.withDescription("A rule id, a finding number from the last check, or a full finding key"),
    ),
  },
  Effect.fn("explain")(function* ({ selector }) {
    const result = yield* explainHandler(new ExplainCommand({ selector }));
    yield* Console.log(result.output);
    if (!result.found) yield* setExitCode(2);
  }),
).pipe(Command.withDescription("Show the standard and guidance behind a rule or finding"));

const review = Command.make(
  "review",
  {
    base: baseFlag,
    mode: Flag.choice("mode", ["review", "calibration"]).pipe(
      Flag.withDescription("Review current findings or calibrate rule fixtures"),
      Flag.withDefault("review"),
    ),
    from: optionalString("from", "artifact.json", "Open a detached review artifact instead of the repository"),
    port: portFlag,
    open: openFlag,
  },
  Effect.fn("review")(function* ({ base, mode, from, port, open }) {
    const artifact = from ? yield* readArtifact(from) : undefined;
    yield* openReviewSession({
      base,
      port,
      open,
      mode: artifact?.state.mode ?? mode,
      artifact: artifact?.state,
      artifactSource: artifact?.source,
    });
  }),
).pipe(Command.withDescription("Open the local review UI for human decisions"));

const pr = Command.make(
  "pr",
  {
    number: Argument.integer("number").pipe(Argument.withDescription("Pull request number")),
    repo: optionalString("repo", "owner/name", "GitHub repository; defaults to the one gh resolves here"),
    artifactOnly: Flag.boolean("artifact-only").pipe(
      Flag.withDescription("Download the review artifact and print its path instead of opening it"),
      Flag.withDefault(false),
    ),
    port: portFlag,
    open: openFlag,
  },
  Effect.fn("pr")(function* ({ number, repo, artifactOnly, port, open }) {
    const result = yield* prHandler(new PrCommand({ number, repo }));
    if (artifactOnly) return yield* Console.log(result.artifactPath);
    yield* openReviewSession({
      port,
      open,
      mode: result.artifact.state.mode,
      artifact: result.artifact.state,
      artifactSource: result.artifactPath,
    });
  }),
).pipe(Command.withDescription("Open the review artifact the GitHub action uploaded for a pull request"));

const rulesList = Command.make(
  "list",
  { file: optionalString("files", "path", "Only show the rules whose scope matches this path") },
  Effect.fn("rulesList")(function* ({ file }) {
    const result = yield* rulesListHandler(new RulesListCommand({ file }));
    if (!result.rules.length) return yield* Console.log("No rules configured.");
    for (const rule of result.rules) {
      yield* Console.log(
        `${rule.enabled ? "on " : "off"} ${rule.id} [${rule.lifecycle}/${rule.authority}] ${rule.title}\n  ${rule.standardId} · ${rule.detector}`,
      );
    }
  }),
).pipe(Command.withDescription("List the configured rules"));

const rulesTest = Command.make(
  "test",
  { rules: ruleFlag },
  Effect.fn("rulesTest")(function* ({ rules }) {
    const result = yield* rulesTestHandler(new RulesTestCommand({ rules }));
    yield* Console.log(result.message);
    yield* setExitCode(result.exitCode);
  }),
).pipe(Command.withDescription("Run every rule against its fixtures"));

const rulesScan = Command.make(
  "scan",
  {
    files: filesArgument,
    rules: ruleFlag,
    base: baseFlag,
    review: Flag.boolean("review").pipe(
      Flag.withDescription("Open the calibration UI on the scan results"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("rulesScan")(function* ({ files, rules, base, review: openReview }) {
    const result = yield* rulesScanHandler(new RulesScanCommand({ rules, base, files: [...files] }));
    yield* Console.log(result.fixtureMessage);
    if (result.exitCode !== 0) return yield* setExitCode(result.exitCode);
    yield* Console.log(`${result.findings.length} calibration candidate${result.findings.length === 1 ? "" : "s"}.`);
    if (openReview) yield* runReviewSession({ base, port: 0, open: true, mode: "calibration" });
  }),
).pipe(Command.withDescription("Run the rules without the gate to calibrate them"));

const rules = Command.make("rules").pipe(
  Command.withDescription("Inspect, test, and calibrate the repository rules"),
  Command.withSubcommands([rulesList, rulesTest, rulesScan]),
);

const acceptancesList = Command.make(
  "list",
  {},
  Effect.fn("acceptancesList")(function* () {
    const result = yield* acceptancesHandler(new AcceptancesCommand({ action: "list", base: undefined, imported: [] }));
    yield* printAcceptances(result);
  }),
).pipe(Command.withDescription("List the current acceptances"));

const acceptancesClean = Command.make(
  "clean",
  { base: baseFlag },
  Effect.fn("acceptancesClean")(function* ({ base }) {
    const result = yield* acceptancesHandler(new AcceptancesCommand({ action: "clean", base, imported: [] }));
    yield* Console.log(`Removed ${result.removedCount} stale acceptance(s).`);
    yield* printAcceptances(result);
  }),
).pipe(Command.withDescription("Remove acceptances whose findings no longer exist"));

const acceptancesImport = Command.make(
  "import",
  {
    file: Argument.string("decisions.jsonl").pipe(
      Argument.withDescription("Decisions exported from a detached review session"),
    ),
    base: baseFlag,
  },
  Effect.fn("acceptancesImport")(function* ({ file, base }) {
    const imported = yield* readAcceptanceRecords(file);
    const result = yield* acceptancesHandler(new AcceptancesCommand({ action: "import", base, imported }));
    if (result.rejectedCount) {
      yield* Console.error(
        `Rejected ${result.rejectedCount} decision(s): the finding changed, disappeared, or requires different authority.`,
      );
      return yield* setExitCode(result.exitCode);
    }
    yield* Console.log(`Imported ${result.importedCount} acceptance(s).`);
    yield* printAcceptances(result);
  }),
).pipe(Command.withDescription("Import decisions exported from a detached review"));

const acceptances = Command.make("acceptances").pipe(
  Command.withDescription("Maintain the acceptance store"),
  Command.withSubcommands([acceptancesList, acceptancesClean, acceptancesImport]),
);

const init = Command.make(
  "init",
  {},
  Effect.fn("init")(function* () {
    const result = yield* initHandler(new InitCommand({}));
    yield* Console.log(result.message);
  }),
).pipe(Command.withDescription("Create .agentlint/config.ts in this repository"));

const agentlint = Command.make("agentlint").pipe(
  Command.withDescription(`${TAGLINE}\n\n${EXIT_CODES}`),
  Command.withSubcommands([check, accept, approve, propose, explain, review, pr, rules, acceptances, init]),
);

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const env = yield* Env;
  yield* Command.runWith(agentlint, { version: __AGENTLINT_VERSION__ })(env.argv);
}).pipe(
  // `runWith` already rendered the help or the usage error; only the exit code is ours.
  Effect.catchFilter(
    (error) => (CliError.isCliError(error) && error._tag === "ShowHelp" ? Result.succeed(error) : Result.fail(error)),
    (error) => (error.errors.length ? setExitCode(2) : Effect.void),
  ),
  Effect.catch((error: unknown) =>
    Effect.gen(function* () {
      const message = error instanceof Error ? error.message : String(error);
      yield* Console.error(`agentlint: ${message}`);
      yield* setExitCode(2);
    }),
  ),
);

const CliOutputLayer = Layer.unwrap(
  Effect.map(Env, (env) =>
    CliOutput.layer({
      ...CliOutput.defaultFormatter({ colors: !env.noColor }),
      formatVersion: (_name, version) => version,
    }),
  ),
);

const AppLayer = Layer.mergeAll(
  ConfigLoader.layer,
  Parser.layer,
  Git.layer,
  Gh.layer,
  AcceptanceStore.layer,
  ProposalStore.layer,
  SelectorCache.layer,
  CliOutputLayer,
).pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(Env.layer));

NodeRuntime.runMain(program.pipe(Effect.provide(AppLayer)) as Effect.Effect<void>);
