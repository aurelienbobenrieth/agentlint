/**
 * Configuration file discovery and loading.
 *
 * Searches the current working directory for a config file, imports it via `jiti` (for TypeScript support without
 * pre-compilation), and validates the exported shape.
 *
 * The config file is loaded from `.agentlint/config.ts`.
 *
 * @module
 * @since 0.1.0
 */

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { fileURLToPath } from "node:url";
import { Env } from "../../config/env.js";
import { normalizeConfig, type AgentlintConfig, type NormalizedConfig } from "../../domain/config.js";

/**
 * Raised when the config file is missing, malformed, or fails to import.
 *
 * @since 0.1.0
 * @category Errors
 */
export class ConfigLoadError extends Schema.TaggedError<ConfigLoadError>()("agentlint/ConfigLoadError", {
  reason: Schema.Literals(["not_found", "import_failed", "invalid_shape", "io"]),
  path: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
  /**
   * Nearest ancestor of `path` that has a config, when the working directory has none.
   */
  ancestor: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return {
      not_found: this.ancestor
        ? `No agentlint config found in ${this.path}. ${this.ancestor} has .agentlint/config.ts: run agentlint from that directory.`
        : `No agentlint config found. Create .agentlint/config.ts in ${this.path}`,
      import_failed: `Failed to load ${this.path}: ${this.detail}`,
      invalid_shape: `Invalid config at ${this.path}: ${this.detail ?? "must export an agentlint config object"}`,
      io: `Cannot look for the agentlint config at ${this.path}: ${this.detail}`,
    }[this.reason];
  }
}

/**
 * Project-relative config file path.
 *
 * @since 0.1.0
 * @category Constants
 */
const CONFIG_PATH = [".agentlint", "config.ts"] as const;

/**
 * Package name the consumer config imports the rule API from.
 *
 * @since 0.2.0
 * @category Constants
 */
const SELF_PACKAGE = "@aurelienbbn/agentlint";

/**
 * Public entries of this package, as `[subpath, built file, source file]`. The built files sit next to `bin.mjs`; the
 * source files are relative to this module.
 */
const SELF_ENTRIES = [
  [SELF_PACKAGE, "index.mjs", "../../index.ts"],
  [`${SELF_PACKAGE}/testing`, "testing.mjs", "../../testing.ts"],
  [`${SELF_PACKAGE}/contract`, "contract.mjs", "../../features/review/contract.ts"],
  [`${SELF_PACKAGE}/calibration`, "calibration.mjs", "../../features/calibration/report.ts"],
] as const;

/**
 * Map `@aurelienbbn/agentlint` and its subpaths to the running copy of the package so `npx @aurelienbbn/agentlint
 * check` works in a repository that never installed it. tsdown bundles this module into `dist/bin.mjs`, next to
 * `index.mjs`; under vitest it runs from `src/shared/infrastructure/`. The consumer's rules are then evaluated by the
 * same version that validates them.
 *
 * @since 0.2.0
 * @category Internals
 */
const selfAliases = Effect.fn("ConfigLoader.selfAliases")(function* ({
  fs,
  path,
}: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = yield* fs.exists(path.join(here, "index.mjs")).pipe(Effect.orElseSucceed(() => false));
  return Object.fromEntries(
    SELF_ENTRIES.map(([specifier, built, source]) => [specifier, path.resolve(here, bundled ? built : source)]),
  );
});

/**
 * Discover the config file path.
 *
 * @since 0.1.0
 * @category Internals
 */
const discoverConfig = Effect.fn("ConfigLoader.discoverConfig")(function* ({
  fs,
  path,
  cwd,
}: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly cwd: string;
}) {
  // An unreadable directory is an I/O error, not a missing config.
  const exists = (file: string) =>
    fs
      .exists(file)
      .pipe(
        Effect.mapError(
          (error) => new ConfigLoadError({ reason: "io", path: file, detail: error.message, cause: error }),
        ),
      );
  const candidate = path.resolve(cwd, ...CONFIG_PATH);
  if (yield* exists(candidate)) {
    return candidate;
  }
  // A second config scaffolded in a subdirectory would split the repository's decisions: name the existing one.
  const findAncestor: (dir: string) => Effect.Effect<string, ConfigLoadError> = Effect.fn("ConfigLoader.findAncestor")(
    function* (dir: string) {
      if (yield* exists(path.resolve(dir, ...CONFIG_PATH)))
        return yield* new ConfigLoadError({ reason: "not_found", path: cwd, ancestor: dir });
      const parent = path.dirname(dir);
      if (dir === parent) return yield* new ConfigLoadError({ reason: "not_found", path: cwd });
      return yield* findAncestor(parent);
    },
  );
  return yield* findAncestor(path.dirname(cwd));
});

/**
 * Effect service that discovers and loads the agentlint config file.
 *
 * Uses `jiti` under the hood so TypeScript configs work without a separate compilation step. The config is imported and
 * normalized once per service instance; later `load()` calls return the same result.
 *
 * @since 0.1.0
 * @category Services
 * @example
 *   ```ts
 *   import { Console, Effect } from "effect";
 *   import { ConfigLoader } from "./infrastructure/config-loader.js";
 *
 *   const program = Effect.gen(function* () {
 *     const loader = yield* ConfigLoader;
 *     const config = yield* loader.load();
 *     yield* Console.log(config.rules.map((rule) => rule.binding.id));
 *   });
 *   ```;
 */
export class ConfigLoader extends Context.Service<
  ConfigLoader,
  {
    /**
     * Discover, import, and normalize the config file from the working directory. Memoized.
     */
    load(): Effect.Effect<NormalizedConfig, ConfigLoadError>;
  }
>()("agentlint/ConfigLoader") {
  static readonly layer: Layer.Layer<ConfigLoader, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    ConfigLoader,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const load = Effect.gen(function* () {
        const configPath = yield* discoverConfig({ fs, path, cwd: env.cwd });
        const alias = yield* selfAliases({ fs, path });

        const config = yield* Effect.tryPromise({
          try: async () => {
            const { createJiti } = await import("jiti");
            const jiti = createJiti(import.meta.url, { interopDefault: true, alias });
            const loaded = await jiti.import<AgentlintConfig & { readonly default?: AgentlintConfig }>(configPath);
            return loaded.default ?? loaded;
          },
          catch: (error) =>
            new ConfigLoadError({
              reason: "import_failed",
              path: configPath,
              detail: Schema.is(Schema.instanceOf(Error))(error) ? error.message : String(error),
              cause: error,
            }),
        });

        return yield* Effect.try({
          try: () => normalizeConfig(config),
          catch: (error) =>
            new ConfigLoadError({
              reason: "invalid_shape",
              path: configPath,
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
        });
      });

      const cached = yield* Effect.cached(load);
      return ConfigLoader.of({ load: () => cached });
    }),
  );
}
