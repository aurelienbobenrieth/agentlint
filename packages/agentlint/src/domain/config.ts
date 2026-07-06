/**
 * Configuration types and helpers.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";
import type { AgentlintRule } from "./rule.js";
import { RuleDefinition } from "./rule.js";

export const Persistence = Schema.Literals(["ephemeral", "durable"]);
export type Persistence = Schema.Schema.Type<typeof Persistence>;

/**
 * Who may record an accepting disposition for a rule's findings.
 *
 * - `agent`: any actor can accept, defer, or no-fix (default).
 * - `human`: agents can fix code or request approval, but only a human
 *   `approve` unblocks the finding. Pending requests block `check --ci`.
 *
 * @since 0.2.0
 */
export const Resolution = Schema.Literals(["agent", "human"]);
export type Resolution = Schema.Schema.Type<typeof Resolution>;

export const RuleSwitch = Schema.Literals(["on", "off"]);
export type RuleSwitch = Schema.Schema.Type<typeof RuleSwitch>;

export const RulePolicy = Schema.Struct({
  persistence: Schema.optional(Persistence),
  resolution: Schema.optional(Resolution),
});
export type RulePolicy = Schema.Schema.Type<typeof RulePolicy>;

export interface ConfigOverride {
  readonly files: ReadonlyArray<string>;
  readonly ignores?: ReadonlyArray<string> | undefined;
  readonly rules: Record<string, RuleSwitch>;
}

/**
 * Learned-notes configuration. Notes are markdown files with trigger
 * frontmatter surfaced as non-blocking context during `check`.
 *
 * @since 0.2.0
 */
export interface NotesConfig {
  /** Directories scanned for note markdown files. Default: `.agents/learn`. */
  readonly dirs?: ReadonlyArray<string> | undefined;
}

export interface AgentlintConfig {
  readonly extends?: ReadonlyArray<AgentlintConfig> | undefined;
  readonly rules?: Record<string, AgentlintRule> | undefined;
  readonly policy?: Record<string, RulePolicy> | undefined;
  readonly files?: ReadonlyArray<string> | undefined;
  readonly ignores?: ReadonlyArray<string> | undefined;
  readonly overrides?: ReadonlyArray<ConfigOverride> | undefined;
  readonly notes?: NotesConfig | undefined;
}

export interface NormalizedConfig {
  readonly rules: Record<string, AgentlintRule>;
  readonly policy: Record<string, Required<RulePolicy>>;
  readonly files?: ReadonlyArray<string> | undefined;
  readonly ignores: ReadonlyArray<string>;
  readonly overrides: ReadonlyArray<ConfigOverride>;
  readonly noteDirs: ReadonlyArray<string>;
}

const RulePolicyDecoder = Schema.decodeUnknownSync(RulePolicy);
const RuleSwitchDecoder = Schema.decodeUnknownSync(RuleSwitch);

function flattenConfig(config: AgentlintConfig, output: AgentlintConfig[] = []): AgentlintConfig[] {
  for (const preset of config.extends ?? []) {
    flattenConfig(preset, output);
  }
  output.push(config);
  return output;
}

function validateRule(id: string, rule: AgentlintRule): void {
  Schema.decodeUnknownSync(RuleDefinition)({
    id: rule.id,
    description: rule.description,
    guidance: rule.guidance,
  });
  if (rule.id !== id) {
    throw new Error(`Config rule key "${id}" must match rule id "${rule.id}"`);
  }
}

export function defineConfig(config: AgentlintConfig): AgentlintConfig {
  for (const [id, rule] of Object.entries(config.rules ?? {})) {
    validateRule(id, rule);
  }
  for (const policy of Object.values(config.policy ?? {})) {
    RulePolicyDecoder(policy);
  }
  for (const override of config.overrides ?? []) {
    if (!override.files || override.files.length === 0) {
      throw new Error("Config overrides must define at least one files pattern");
    }
    for (const state of Object.values(override.rules)) {
      RuleSwitchDecoder(state);
    }
  }
  return config;
}

export const definePreset = defineConfig;

export function normalizeConfig(config: AgentlintConfig): NormalizedConfig {
  const layers = flattenConfig(config);
  const rules: Record<string, AgentlintRule> = {};
  const policy: Record<string, Required<RulePolicy>> = {};
  let files: ReadonlyArray<string> | undefined;
  const ignores: string[] = [];
  const overrides: ConfigOverride[] = [];
  const noteDirs: string[] = [];

  for (const layer of layers) {
    for (const [id, rule] of Object.entries(layer.rules ?? {})) {
      validateRule(id, rule);
      rules[id] = rule;
    }
    for (const [id, rulePolicy] of Object.entries(layer.policy ?? {})) {
      RulePolicyDecoder(rulePolicy);
      policy[id] = {
        persistence: rulePolicy.persistence ?? policy[id]?.persistence ?? "ephemeral",
        resolution: rulePolicy.resolution ?? policy[id]?.resolution ?? "agent",
      };
    }
    if (layer.files) {
      files = [...layer.files];
    }
    ignores.push(...(layer.ignores ?? []));
    overrides.push(...(layer.overrides ?? []));
    for (const dir of layer.notes?.dirs ?? []) {
      if (!noteDirs.includes(dir)) noteDirs.push(dir);
    }
  }

  for (const id of Object.keys(rules)) {
    policy[id] = policy[id] ?? { persistence: "ephemeral", resolution: "agent" };
  }

  for (const id of Object.keys(policy)) {
    if (!rules[id]) {
      throw new Error(`Unknown rule id in policy: ${id}`);
    }
  }

  for (const override of overrides) {
    if (!override.files || override.files.length === 0) {
      throw new Error("Config overrides must define at least one files pattern");
    }
    for (const [id, state] of Object.entries(override.rules)) {
      RuleSwitchDecoder(state);
      if (!rules[id]) {
        throw new Error(`Unknown rule id in override: ${id}`);
      }
    }
  }

  return {
    rules,
    policy,
    files,
    ignores,
    overrides,
    noteDirs,
  };
}

export function policyForRule(config: NormalizedConfig, ruleId: string): Required<RulePolicy> {
  return config.policy[ruleId] ?? { persistence: "ephemeral", resolution: "agent" };
}
