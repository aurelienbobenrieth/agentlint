/**
 * GitHub CLI access.
 *
 * `agentlint pr` reads pull request artifacts through the authenticated
 * `gh` binary so the package never carries a GitHub client or a token.
 *
 * @module
 * @since 0.2.0
 */

import { execFile } from "node:child_process";
import { Context, Effect, Layer, Schema } from "effect";
import { Env } from "../../config/env.js";

/** @since 0.2.0 @category errors */
export class GhError extends Schema.TaggedError<GhError>()("agentlint/GhError", {
  reason: Schema.Literals(["missing", "failed"]),
  args: Schema.Array(Schema.String),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.reason === "missing"
      ? "The GitHub CLI (gh) is not installed or not on PATH"
      : `gh ${this.args.join(" ")} failed: ${this.detail}`;
  }
}

const isMissingBinary = (error: { readonly code?: string | number | undefined }): boolean => error.code === "ENOENT";

const ghCommand = (cwd: string, args: ReadonlyArray<string>): Effect.Effect<Buffer, GhError> =>
  Effect.callback<Buffer, GhError>((resume) => {
    execFile(
      "gh",
      [...args],
      { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.toString("utf8").trim() || error.message;
          resume(
            Effect.fail(
              new GhError({ reason: isMissingBinary(error) ? "missing" : "failed", args: [...args], detail }),
            ),
          );
        } else {
          resume(Effect.succeed(stdout));
        }
      },
    );
  });

/**
 * Runs `gh` in the working directory.
 *
 * @since 0.2.0
 * @category services
 */
export class Gh extends Context.Service<
  Gh,
  {
    /** Run `gh` and return its UTF-8 stdout. */
    text(args: ReadonlyArray<string>): Effect.Effect<string, GhError>;
    /** Run `gh` and return its raw stdout, for endpoints that stream a file. */
    binary(args: ReadonlyArray<string>): Effect.Effect<Uint8Array, GhError>;
  }
>()("agentlint/Gh") {
  static readonly layer: Layer.Layer<Gh, never, Env> = Layer.effect(
    Gh,
    Effect.gen(function* () {
      const env = yield* Env;
      return Gh.of({
        text: (args) => ghCommand(env.cwd, args).pipe(Effect.map((stdout) => stdout.toString("utf8"))),
        binary: (args) => ghCommand(env.cwd, args),
      });
    }),
  );
}
