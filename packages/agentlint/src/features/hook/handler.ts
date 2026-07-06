/**
 * Harness hook adapters.
 *
 * `agentlint hook claude-code` is a PostToolUse adapter: it reads the hook
 * payload from stdin, checks only the file that was just edited, and - when
 * blocking findings exist - prints them to stderr and exits 2, which Claude
 * Code feeds back to the model. This closes the loop deterministically:
 * the agent does not need to remember to run check.
 *
 * The commit/CI gates remain the hard guarantee; hook adapters only shorten
 * the distance between an edit and its feedback.
 *
 * @module
 * @since 0.2.0
 */

import { Effect, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import { normalizeConfig } from "../../domain/config.js";
import { formatCheckText } from "../../cli/reporter.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";

const HookPayload = Schema.Struct({
  hook_event_name: Schema.optional(Schema.String),
  tool_name: Schema.optional(Schema.String),
  tool_input: Schema.optional(
    Schema.Struct({
      file_path: Schema.optional(Schema.String),
    }),
  ),
});

const HookPayloadFromString = Schema.decodeUnknownSync(Schema.fromJsonString(HookPayload));

export interface HookResult {
  /** Text for stderr when blocking; empty otherwise. */
  readonly feedback: string;
  /** 0 = silent pass, 2 = blocking feedback for the model. */
  readonly exitCode: number;
}

export const claudeCodeHookHandler = Effect.fn("claudeCodeHookHandler")(function* () {
  const env = yield* Env;
  const path = yield* Path.Path;
  const configLoader = yield* ConfigLoader;

  const raw = yield* Effect.tryPromise({
    try: () => env.readStdin(),
    catch: () => new Error("Failed to read hook payload from stdin"),
  }).pipe(Effect.orElseSucceed(() => ""));

  let filePath: string | undefined;
  try {
    filePath = HookPayloadFromString(raw).tool_input?.file_path;
  } catch {
    // Not a payload we understand - stay silent rather than break the harness.
    return { feedback: "", exitCode: 0 } satisfies HookResult;
  }
  if (!filePath) return { feedback: "", exitCode: 0 } satisfies HookResult;

  const relative = path.relative(env.cwd, path.resolve(env.cwd, filePath)).replace(/\\/g, "/");
  if (relative.startsWith("..")) return { feedback: "", exitCode: 0 } satisfies HookResult;

  const result = yield* checkHandler(
    new CheckCommand({
      all: false,
      rules: [],
      base: undefined,
      files: [relative],
      format: "text",
      ci: false,
    }),
  ).pipe(Effect.orElseSucceed(() => undefined));

  // Config missing or scan failure: hooks must never break the harness.
  if (!result || result.noMatchingRules || result.exitCode !== 1) {
    return { feedback: "", exitCode: 0 } satisfies HookResult;
  }

  const config = normalizeConfig(yield* configLoader.load());
  const text = yield* formatCheckText(result.displayedFindings, config, { version: "hook", ci: false });
  return { feedback: text, exitCode: 2 } satisfies HookResult;
});
