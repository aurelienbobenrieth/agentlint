/**
 * Configuration file discovery and loading.
 *
 * Searches the current working directory for a config file, imports it
 * via `jiti` (for TypeScript support without pre-compilation), and
 * validates the exported shape.
 *
 * The config file is loaded from `.agentlint/config.ts`.
 *
 * @module
 * @since 0.1.0
 */

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import type { AgentlintConfig } from "../../domain/config.js";

/**
 * Raised when the config file is missing, malformed, or fails to import.
 *
 * @since 0.1.0
 * @category errors
 */
export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()("ConfigError", {
  message: Schema.String,
}) {}

/**
 * Project-relative config file path.
 *
 * @since 0.1.0
 * @category constants
 */
const CONFIG_PATH = [".agentlint", "config.ts"] as const;

/**
 * Discover the config file path.
 *
 * @since 0.1.0
 * @category internals
 */
const discoverConfig = (fs: FileSystem.FileSystem, path: Path.Path, cwd: string): Effect.Effect<string, ConfigError> =>
  Effect.gen(function* () {
    const candidate = path.resolve(cwd, ...CONFIG_PATH);
    if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
      return candidate;
    }
    return yield* new ConfigError({
      message: `No agentlint config found. Create .agentlint/config.ts in ${cwd}`,
    });
  });

/**
 * Effect service that discovers and loads the agentlint config file.
 *
 * Uses `jiti` under the hood so TypeScript configs work without a
 * separate compilation step.
 *
 * @example
 * ```ts
 * import { Console, Effect } from "effect"
 * import { ConfigLoader } from "./infrastructure/config-loader.js"
 *
 * const program = Effect.gen(function* () {
 *   const loader = yield* ConfigLoader
 *   const config = yield* loader.load()
 *   yield* Console.log(Object.keys(config.rules))
 * })
 * ```
 *
 * @since 0.1.0
 * @category services
 */
export class ConfigLoader extends Context.Service<
  ConfigLoader,
  {
    /** Discover and import the config file from the working directory. */
    load(): Effect.Effect<AgentlintConfig, ConfigError>;
  }
>()("agentlint/ConfigLoader") {
  static readonly layer: Layer.Layer<ConfigLoader, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    ConfigLoader,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      return ConfigLoader.of({
        load: () =>
          Effect.gen(function* () {
            const configPath = yield* discoverConfig(fs, path, env.cwd);

            const config = yield* Effect.tryPromise({
              try: async () => {
                const { createJiti } = await import("jiti");
                const jiti = createJiti(import.meta.url, {
                  interopDefault: true,
                });
                const loaded = await jiti.import(configPath);
                return (loaded as { default?: AgentlintConfig }).default ?? (loaded as AgentlintConfig);
              },
              catch: (error) =>
                new ConfigError({
                  message: error instanceof Error ? error.message : String(error),
                }),
            });

            if (!config || typeof config !== "object") {
              return yield* new ConfigError({
                message: `Invalid config at ${configPath}: must export an agentlint config object`,
              });
            }

            return config;
          }),
      });
    }),
  );
}
