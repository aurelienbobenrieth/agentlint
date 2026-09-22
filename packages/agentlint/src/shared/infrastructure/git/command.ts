/**
 * Process boundary for deterministic, read-only Git commands. @module
 */

import { execFile } from "node:child_process";
import { Effect, Schema } from "effect";

/**
 * Largest Git output accepted by the adapter.
 */
export const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export interface GitCommandFailure {
  readonly exitCode: number | undefined;
  readonly code: string | undefined;
  readonly detail: string;
}

const GitCommandFailureSchema = Schema.Struct({
  exitCode: Schema.UndefinedOr(Schema.Number),
  code: Schema.UndefinedOr(Schema.String),
  detail: Schema.String,
});

const isNumber = Schema.is(Schema.Number);
const isString = Schema.is(Schema.String);

export const runGitCommand = ({
  cwd,
  args,
  literalPathspecs,
  variables,
}: {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly literalPathspecs: boolean;
  readonly variables?: Readonly<NodeJS.ProcessEnv>;
}): Effect.Effect<string, GitCommandFailure> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          [
            "-c",
            "core.fsmonitor=false",
            "-c",
            "color.ui=false",
            "-c",
            "diff.algorithm=myers",
            "-c",
            "diff.indentHeuristic=false",
            "--no-optional-locks",
            ...(literalPathspecs ? ["--literal-pathspecs"] : []),
            ...args,
          ],
          {
            cwd,
            encoding: "utf8",
            maxBuffer: GIT_MAX_BUFFER_BYTES,
            windowsHide: true,
            signal,
            timeout: 120_000,
            env: variables ? { ...variables, LANG: "C", LC_ALL: "C" } : undefined,
          },
          (error, stdout, stderr) => {
            if (!error) return resolve(stdout);
            reject({
              exitCode: isNumber(error.code) ? error.code : undefined,
              code: isString(error.code) ? error.code : undefined,
              detail: stderr.trim() || error.message,
            } satisfies GitCommandFailure);
          },
        );
      }),
    catch: (failure) => Schema.decodeUnknownSync(GitCommandFailureSchema)(failure),
  });
