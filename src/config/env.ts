/**
 * Centralised process / environment access.
 *
 * **This is the only module in the codebase that may touch `process.*`.**
 *
 * Every other module that needs the working directory, TTY state, colour
 * preference, or exit-code control must depend on the `Env` service
 * instead of reaching into `process` directly.
 *
 * The layer is built once at startup with `Layer.sync` (no external
 * dependencies), so it can be provided before every other service layer.
 *
 * @module
 * @since 0.1.0
 */

import { Layer } from "effect";
import * as ServiceMap from "effect/ServiceMap";

/**
 * Read-only snapshot of the runtime environment.
 *
 * @since 0.1.0
 * @category services
 */
export class Env extends ServiceMap.Service<
  Env,
  {
    /** Current working directory, captured at startup. */
    readonly cwd: string;
    /** `true` when ANSI colour codes should be suppressed (`NO_COLOR` or non-TTY). */
    readonly noColor: boolean;
    /** `true` when stdout is an interactive terminal. */
    readonly isTTY: boolean;
    /** Set the process exit code (non-zero signals failure to the shell). */
    setExitCode(code: number): void;
  }
>()("agentlint/Env") {
  /**
   * Default layer — reads from `process` globals exactly once.
   *
   * @since 0.1.0
   * @category layers
   */
  static readonly layer: Layer.Layer<Env> = Layer.sync(Env, () => {
    /* eslint-disable n/no-process-env -- single authorised access point */
    const isTTY = process.stdout.isTTY ?? false;
    return Env.of({
      cwd: process.cwd(),
      noColor: !!process.env["NO_COLOR"] || !isTTY,
      isTTY,
      setExitCode: (code) => {
        process.exitCode = code;
      },
    });
    /* eslint-enable n/no-process-env */
  });
}
