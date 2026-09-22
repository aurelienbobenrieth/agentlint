#!/usr/bin/env node
/**
 * Agentlint command line application. @module @since 0.2.0
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, FileSystem, Layer, Path, Result } from "effect";
import { Argument, CliError, CliOutput, Command, Flag } from "effect/unstable/cli";
import {
  baseFlag,
  filesArgument,
  openFlag,
  optionalString,
  portFlag,
  ruleFlag,
  selectorArgument,
} from "./cli/options.js";
import { formatCheckJsonl, formatCheckText } from "./cli/reporter.js";
import { readAcceptanceRecords, readArtifact, writeReviewArtifact } from "./cli/review-artifact.js";
import { openReviewSession, printAcceptances, setExitCode } from "./cli/runtime.js";
import { Env } from "./config/env.js";
import { acceptHandler } from "./features/accept/handler.js";
import { AcceptCommand } from "./features/accept/request.js";
import { acceptancesHandler } from "./features/acceptances/handler.js";
import { AcceptancesCommand } from "./features/acceptances/request.js";
import { checkHandler } from "./features/check/handler.js";
import { CheckCommand } from "./features/check/request.js";
import { explainHandler } from "./features/explain/handler.js";
import { ExplainCommand } from "./features/explain/request.js";
import { nextHandler } from "./features/next/handler.js";
import { NextCommand } from "./features/next/request.js";
import { calibrationHandler } from "./features/calibration/handler.js";
import { CalibrationCommand } from "./features/calibration/request.js";
import { initHandler } from "./features/init/handler.js";
import { InitCommand } from "./features/init/request.js";
import { prHandler } from "./features/pr/handler.js";
import { PrCommand } from "./features/pr/request.js";
import { proposeHandler } from "./features/propose/handler.js";
import { ProposeCommand } from "./features/propose/request.js";
import { rulesListHandler, rulesScanHandler, rulesTestHandler } from "./features/rules/handler.js";
import { RulesListCommand, RulesScanCommand, RulesTestCommand } from "./features/rules/request.js";
import { AcceptanceStore } from "./shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "./shared/infrastructure/config-loader.js";
import { Gh } from "./shared/infrastructure/gh.js";
import { Git } from "./shared/infrastructure/git/service.js";
import { encodeJson, encodePrettyJson } from "./shared/infrastructure/json.js";
import { Parser } from "./shared/infrastructure/parser.js";
import { ProposalStore } from "./shared/infrastructure/proposal-store.js";
import { SelectorCache } from "./shared/infrastructure/selector-cache.js";

declare const __AGENTLINT_VERSION__: string;

const TAGLINE = "Deterministic findings. Explicit judgment. Repository-owned review decisions.";
const EXIT_CODES = "Exit codes: 0 gate open; 1 unresolved findings; 2 usage or configuration error.";

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const check = Command.make(
  "check",
  {
    files: filesArgument,
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("Inspect the whole repository instead of the changed files"),
      Flag.withDefault(false),
    ),
    base: baseFlag,
    rules: ruleFlag,
    format: Flag.Literals("format", ["text", "jsonl"]).pipe(
      Flag.withDescription("Output format"),
      Flag.withDefault("text"),
    ),
    reviewOutput: optionalString({
      name: "review-output",
      metavar: "path",
      description: "Write a detached review artifact to this path",
    }),
  },
  Effect.fn("check")(function* ({ files, all, base, rules, format, reviewOutput }) {
    const command = new CheckCommand({ all, rules, base, files: [...files] });
    const result = yield* checkHandler(command);
    if (result.noMatchingRules) {
      yield* Console.error(`No matching rules. Available: ${result.availableRules.join(", ") || "none"}`);
      yield* setExitCode(2);
      return;
    }
    const config = yield* (yield* ConfigLoader).load();
    const output =
      format === "jsonl"
        ? formatCheckJsonl({ findings: result.unresolved, config, lineage: result.lineage })
        : yield* formatCheckText({
            findings: result.unresolved,
            config,
            version: __AGENTLINT_VERSION__,
            lineage: result.lineage,
          });
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

const next = Command.make(
  "next",
  {
    base: baseFlag,
    rules: ruleFlag,
    format: Flag.Literals("format", ["text", "json"]).pipe(Flag.withDefault("text")),
  },
  Effect.fn("next")(function* ({ base, rules, format }) {
    const result = yield* nextHandler(new NextCommand({ base, rules }));
    if (format === "json") yield* Console.log(encodePrettyJson(result));
    else {
      yield* Console.log(
        result.finding
          ? [
              `${result.remaining} unresolved · ${result.scope} scan`,
              `${result.finding.ruleTitle} · ${result.finding.file}:${result.finding.line}`,
              result.finding.message,
              result.finding.guidance.standard,
              `Required authority: ${result.finding.authority}`,
              ...result.actions.map(
                (action) =>
                  `${action.purpose}: agentlint argv=${encodeJson(action.argv.map((arg) => (arg === result.finding?.id ? (result.selector ?? arg) : arg)))}${action.requiredInput ? ` + ${action.requiredInput}` : ""}`,
              ),
            ].join("\n")
          : result.status === "no_matching_rules"
            ? "No matching rules. Configure a rule before using the gate."
            : `No unresolved findings in this ${result.scope} scan.${result.scope === "partial" ? " Run check --all for the complete checkpoint." : ""}`,
      );
    }
    yield* setExitCode(result.exitCode);
  }),
).pipe(
  Command.withDescription("Return one current obligation with evidence, authority and executable argument arrays"),
);

const decisionCommand = ({
  name,
  authority,
  description,
}: {
  readonly name: "accept" | "approve";
  readonly authority: "agent" | "human";
  readonly description: string;
}) =>
  Command.make(
    name,
    {
      selector: selectorArgument,
      reason: Flag.String("reason").pipe(Flag.withDescription("Why this finding satisfies its standard")),
      base: baseFlag,
    },
    Effect.fn("decisionCommand.execute")(function* ({ selector, reason, base }) {
      const result = yield* acceptHandler(new AcceptCommand({ selector, reason, authority, base }));
      yield* Console.log(result.message);
      yield* setExitCode(result.exitCode);
    }),
  ).pipe(Command.withDescription(description));

const accept = decisionCommand({
  name: "accept",
  authority: "agent",
  description: "Record an acceptance with agent authority",
});
const approve = decisionCommand({
  name: "approve",
  authority: "human",
  description: "Record an acceptance with human authority",
});

const propose = Command.make(
  "propose",
  {
    selector: selectorArgument,
    summary: Flag.String("summary").pipe(Flag.withDescription("What the agent did or suggests for this finding")),
    diffFile: optionalString({
      name: "diff-file",
      metavar: "path",
      description: "Attach the unified diff stored in this file",
    }),
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
    selector: Argument.String("rule-id|selector").pipe(
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
    mode: Flag.Literals("mode", ["review", "calibration"]).pipe(
      Flag.withDescription("Review current findings or calibrate rule fixtures"),
      Flag.withDefault("review"),
    ),
    from: optionalString({
      name: "from",
      metavar: "artifact.json",
      description: "Open a detached review artifact instead of the repository",
    }),
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
    });
  }),
).pipe(Command.withDescription("Open the local review UI for human decisions"));

const pr = Command.make(
  "pr",
  {
    number: Argument.Int("number").pipe(Argument.withDescription("Pull request number")),
    repo: optionalString({
      name: "repo",
      metavar: "owner/name",
      description: "GitHub repository; defaults to the one gh resolves here",
    }),
    artifactOnly: Flag.Boolean("artifact-only").pipe(
      Flag.withDescription("Download the review artifact and print its path instead of opening it"),
      Flag.withDefault(false),
    ),
    port: portFlag,
    open: openFlag,
  },
  Effect.fn("pr")(function* ({ number, repo, artifactOnly, port, open }) {
    const result = yield* prHandler(new PrCommand({ number, repo }));
    if (artifactOnly) {
      yield* Console.log(result.artifactPath);
      return;
    }
    yield* openReviewSession({
      port,
      open,
      mode: result.artifact.state.mode,
      artifact: result.artifact.state,
    });
  }),
).pipe(Command.withDescription("Open the review artifact the GitHub action uploaded for a pull request"));

const rulesList = Command.make(
  "list",
  {
    file: optionalString({
      name: "files",
      metavar: "path",
      description: "Only show the rules whose scope matches this path",
    }),
  },
  Effect.fn("rulesList")(function* ({ file }) {
    const result = yield* rulesListHandler(new RulesListCommand({ file }));
    if (!result.rules.length) {
      yield* Console.log("No rules configured.");
      return;
    }
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
    review: Flag.Boolean("review").pipe(
      Flag.withDescription("Open the calibration UI on the scan results"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("rulesScan")(function* ({ files, rules, base, review: openReview }) {
    const result = yield* rulesScanHandler(new RulesScanCommand({ rules, base, files: [...files] }));
    yield* Console.log(result.fixtureMessage);
    if (result.exitCode !== 0) {
      yield* setExitCode(result.exitCode);
      return;
    }
    yield* Console.log(`${result.findings.length} calibration candidate${result.findings.length === 1 ? "" : "s"}.`);
    if (openReview)
      yield* openReviewSession({ base, rules, files: [...files], port: 0, open: true, mode: "calibration" });
  }),
).pipe(Command.withDescription("Run the rules without the gate to calibrate them"));

const calibration = Command.make(
  "calibration",
  {
    reports: Argument.String("reports").pipe(Argument.variadic({ min: 1 })),
    format: Flag.Literals("format", ["text", "json"]).pipe(Flag.withDefault("text")),
  },
  Effect.fn("calibration")(function* ({ reports, format }) {
    const result = yield* calibrationHandler(new CalibrationCommand({ files: [...reports] }));
    yield* Console.log(
      format === "json"
        ? encodePrettyJson(result)
        : result.rules.length === 0
          ? "No calibration observations."
          : result.rules
              .map(
                (rule) =>
                  `${rule.project} / ${rule.ruleId} (standard ${rule.standardRevision}, detector ${rule.detectorVersion})\n  ${rule.reviewed} reviewed: ${rule.applies} applies, ${rule.doesNotApply} does not apply, ${rule.unsure} unsure\n  Applicability: ${rule.applicabilityRate === null ? "not measured" : Math.round(rule.applicabilityRate * 100) + "%"}\n  Reasons: ${encodeJson(rule.reasons)}\n  ${rule.invalidatedEvidence} distinct invalidated observations; ${rule.repeatedInvalidationLineages} repeatedly invalidated lineages`,
              )
              .join("\n"),
    );
  }),
).pipe(
  Command.withDescription("Combine exported calibration reports; later reports replace labels for the same evidence"),
);

const rules = Command.make("rules").pipe(
  Command.withDescription("Inspect, test, and calibrate the repository rules"),
  Command.withSubcommands([rulesList, rulesTest, rulesScan, calibration]),
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
    file: Argument.String("decisions.jsonl").pipe(
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
      yield* setExitCode(result.exitCode);
      return;
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
  {
    presets: Flag.String("preset").pipe(
      Flag.atLeast(0),
      Flag.withDescription("Chosen package#export; repeat to compose presets"),
    ),
  },
  Effect.fn("init")(function* ({ presets }) {
    const result = yield* initHandler(new InitCommand({ presets }));
    yield* Console.log(result.message);
  }),
).pipe(Command.withDescription("Create .agentlint/config.ts in this repository"));

const agentlint = Command.make("agentlint").pipe(
  Command.withDescription(`${TAGLINE}\n\n${EXIT_CODES}`),
  Command.withSubcommands([check, next, accept, approve, propose, explain, review, pr, rules, acceptances, init]),
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
  Effect.catch((error) =>
    Effect.gen(function* () {
      const message = error instanceof Error ? error.message : String(error);
      yield* Console.error(`agentlint: ${message}`);
      yield* setExitCode(2);
    }),
  ),
);

const CliOutputLayer = Layer.unwrap(
  Effect.map(Env, (env) =>
    CliOutput.layer(
      Object.assign(CliOutput.defaultFormatter({ colors: !env.noColor }), {
        formatVersion: (...[, version]: [string, string]) => version,
      }),
    ),
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
).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, Env.layer)));

NodeRuntime.runMain(program.pipe(Effect.provide(AppLayer)));
