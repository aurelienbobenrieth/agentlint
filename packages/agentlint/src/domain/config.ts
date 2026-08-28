/** Repository configuration contracts. @module @since 0.2.0 */

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

function assertConfig(config: AgentlintConfig): void {
  if (config.base !== undefined && config.base.trim().length === 0) {
    throw new Error("Config base must not be empty");
  }
  for (const ignore of config.ignores ?? []) {
    if (ignore.trim().length === 0) throw new Error("Config ignore patterns must not be empty");
  }
}

/** Define a repository config without widening its rule lifecycle literals. */
export function defineConfig<const Config extends AgentlintConfig>(config: Config): Config {
  assertConfig(config);
  return config;
}

function flatten(config: AgentlintConfig, output: AgentlintConfig[] = [], active = new Set<AgentlintConfig>()): void {
  if (active.has(config)) throw new Error("Config extends contains a cycle");
  active.add(config);
  for (const parent of config.extends ?? []) flatten(parent, output, active);
  active.delete(config);
  output.push(config);
}

/** Resolve config layers and reject ambiguous binding identities. */
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
      if (rulesById.has(id)) throw new Error(`Duplicate rule binding id: ${id}`);
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
