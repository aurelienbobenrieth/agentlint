/**
 * Repository configuration contracts. @module @since 0.2.0
 */

import { Equal, Result, Schema } from "effect";
import { normalizeGuidance } from "./guidance.js";
import { defineRule, type AgentlintRule, type RuleStandard } from "./rule/model.js";

export interface AgentlintConfig {
  /**
   * Reusable configuration layers. Earlier layers load first.
   */
  readonly extends?: ReadonlyArray<AgentlintConfig> | undefined;
  /**
   * Each array entry is one enabled repository binding.
   */
  readonly rules?: ReadonlyArray<AgentlintRule> | undefined;
  /**
   * Repository-wide paths that agentlint never inspects.
   */
  readonly ignores?: ReadonlyArray<string> | undefined;
  /**
   * Default Git comparison ref. CLI `--base` takes precedence.
   */
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
 * @category Errors
 */
export class ConfigError extends Schema.TaggedError<ConfigError>()("agentlint/ConfigError", {
  reason: Schema.Literals([
    "invalid_shape",
    "empty_base",
    "empty_ignore",
    "duplicate_binding",
    "conflicting_standard",
    "extends_cycle",
  ]),
  ruleId: Schema.optional(Schema.String),
  standardId: Schema.optional(Schema.String),
  conflictingRuleId: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return {
      invalid_shape: `Invalid config shape: ${this.detail}`,
      empty_base: "Config base must not be empty",
      empty_ignore: "Config ignore patterns must not be empty",
      duplicate_binding: `Duplicate rule binding id: ${this.ruleId}`,
      conflicting_standard: `Standard ${this.standardId} differs between bindings ${this.conflictingRuleId} and ${this.ruleId}; share one standard definition`,
      extends_cycle: "Config extends contains a cycle",
    }[this.reason];
  }
}

const decodeConfigShape = Schema.decodeUnknownResult(
  Schema.Struct({
    extends: Schema.optional(Schema.Array(Schema.Unknown)),
    rules: Schema.optional(Schema.Array(Schema.Unknown)),
    ignores: Schema.optional(Schema.Array(Schema.String)),
    base: Schema.optional(Schema.String),
  }),
);

function assertConfig(config: AgentlintConfig): void {
  const shape = decodeConfigShape(config);
  if (Result.isFailure(shape)) throw new ConfigError({ reason: "invalid_shape", detail: shape.failure.message });
  if (config.base !== undefined && config.base.trim().length === 0) {
    throw new ConfigError({ reason: "empty_base" });
  }
  for (const ignore of config.ignores ?? []) {
    if (ignore.trim().length === 0) throw new ConfigError({ reason: "empty_ignore" });
  }
}

/**
 * Define a repository config without widening its rule lifecycle literals. Throws `ConfigError`.
 */
export function defineConfig<const Config extends AgentlintConfig>(config: Config): Config {
  assertConfig(config);
  return config;
}

function flatten({
  config,
  output = [],
  active = new Set<AgentlintConfig>(),
}: {
  readonly config: AgentlintConfig;
  readonly output?: AgentlintConfig[];
  readonly active?: Set<AgentlintConfig>;
}): void {
  assertConfig(config);
  if (active.has(config)) throw new ConfigError({ reason: "extends_cycle" });
  active.add(config);
  for (const parent of config.extends ?? []) flatten({ config: parent, output, active });
  active.delete(config);
  output.push(config);
}

/**
 * What a finding shows for its standard. An absent optional field equals one set to `undefined`.
 */
function standardView(standard: RuleStandard) {
  return {
    revision: standard.revision,
    title: standard.title,
    summary: standard.summary,
    source: standard.source,
    guidance: normalizeGuidance(standard.guidance),
  };
}

/**
 * Resolve config layers and reject ambiguous binding identities and standards. Internal to the engine.
 */
export function normalizeConfig(config: AgentlintConfig): NormalizedConfig {
  const layers: AgentlintConfig[] = [];
  flatten({ config, output: layers });
  const rulesById = new Map<string, AgentlintRule>();
  const rulesByStandard = new Map<string, AgentlintRule>();
  const ignores: string[] = [];
  const base = layers.findLast((layer) => layer.base !== undefined)?.base;

  for (const layer of layers) {
    assertConfig(layer);
    for (const rule of layer.rules ?? []) {
      defineRule(rule);
      const id = rule.binding.id;
      if (rulesById.has(id)) throw new ConfigError({ reason: "duplicate_binding", ruleId: id });
      rulesById.set(id, rule);
      const first = rulesByStandard.get(rule.standard.id);
      if (first === undefined) rulesByStandard.set(rule.standard.id, rule);
      else if (!Equal.equals(standardView(first.standard), standardView(rule.standard))) {
        throw new ConfigError({
          reason: "conflicting_standard",
          standardId: rule.standard.id,
          ruleId: id,
          conflictingRuleId: first.binding.id,
        });
      }
    }
    ignores.push(...(layer.ignores ?? []));
  }

  return {
    rules: [...rulesById.values()],
    rulesById,
    ignores: [...new Set(ignores)],
    ...(base === undefined ? {} : { base }),
  };
}
