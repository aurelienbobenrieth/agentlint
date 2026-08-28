/** Repository configuration contracts. @module @since 0.2.0 */

import { Schema } from "effect";
import type { AgentlintRule } from "./rule.js";

export interface AgentlintConfig {
  /** Reusable configuration layers. Earlier layers load first. */
  readonly extends?: ReadonlyArray<AgentlintConfig> | undefined;
  /** Each array entry is one enabled repository binding. */
  readonly rules?: ReadonlyArray<AgentlintRule> | undefined;
  /** Repository-wide paths that agentlint never inspects. */
  readonly ignores?: ReadonlyArray<string> | undefined;
  /** Default Git comparison ref. CLI `--base` takes precedence. */
  readonly base?: string | undefined;
}

export interface NormalizedConfig {
  readonly rules: ReadonlyArray<AgentlintRule>;
  readonly rulesById: ReadonlyMap<string, AgentlintRule>;
  readonly ignores: ReadonlyArray<string>;
  readonly base?: string | undefined;
}

/**
 * Raised by `defineConfig` and config normalization when a config is invalid.
 *
 * @since 0.2.0
 * @category errors
 */
export class ConfigError extends Schema.TaggedError<ConfigError>()("agentlint/ConfigError", {
  reason: Schema.Literals(["empty_base", "empty_ignore", "duplicate_binding", "extends_cycle"]),
  ruleId: Schema.optional(Schema.String),
}) {
  override get message(): string {
    switch (this.reason) {
      case "empty_base":
        return "Config base must not be empty";
      case "empty_ignore":
        return "Config ignore patterns must not be empty";
      case "duplicate_binding":
        return `Duplicate rule binding id: ${this.ruleId}`;
      case "extends_cycle":
        return "Config extends contains a cycle";
    }
  }
}

function assertConfig(config: AgentlintConfig): void {
  if (config.base !== undefined && config.base.trim().length === 0) {
    throw new ConfigError({ reason: "empty_base" });
  }
  for (const ignore of config.ignores ?? []) {
    if (ignore.trim().length === 0) throw new ConfigError({ reason: "empty_ignore" });
  }
}

/** Define a repository config without widening its rule lifecycle literals. Throws `ConfigError`. */
export function defineConfig<const Config extends AgentlintConfig>(config: Config): Config {
  assertConfig(config);
  return config;
}

function flatten(config: AgentlintConfig, output: AgentlintConfig[] = [], active = new Set<AgentlintConfig>()): void {
  if (active.has(config)) throw new ConfigError({ reason: "extends_cycle" });
  active.add(config);
  for (const parent of config.extends ?? []) flatten(parent, output, active);
  active.delete(config);
  output.push(config);
}

/** Resolve config layers and reject ambiguous binding identities. Internal to the engine. */
export function normalizeConfig(config: AgentlintConfig): NormalizedConfig {
  const layers: AgentlintConfig[] = [];
  flatten(config, layers);
  const rulesById = new Map<string, AgentlintRule>();
  const ignores: string[] = [];
  let base: string | undefined;

  for (const layer of layers) {
    assertConfig(layer);
    for (const rule of layer.rules ?? []) {
      const id = rule.binding.id;
      if (rulesById.has(id)) throw new ConfigError({ reason: "duplicate_binding", ruleId: id });
      rulesById.set(id, rule);
    }
    ignores.push(...(layer.ignores ?? []));
    if (layer.base !== undefined) base = layer.base;
  }

  return {
    rules: [...rulesById.values()],
    rulesById,
    ignores: [...new Set(ignores)],
    ...(base === undefined ? {} : { base }),
  };
}
