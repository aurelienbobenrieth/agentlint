import { Effect } from "effect";
import { compactStandard } from "../../domain/guidance.js";
import { normalizeConfig, policyForRule } from "../../domain/config.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { ruleEnabledForFile } from "../../shared/pipeline/collect-findings.js";
import { RulesListCommand, RulesListResult } from "./request.js";

export const rulesListHandler = Effect.fn("rulesListHandler")(function* (command: RulesListCommand) {
  const configLoader = yield* ConfigLoader;
  const config = normalizeConfig(yield* configLoader.load());
  const file = command.file?.replace(/\\/g, "/");

  return new RulesListResult({
    rules: Object.values(config.rules)
      .map((rule) => ({
        id: rule.id,
        description: rule.description,
        persistence: policyForRule(config, rule.id).persistence ?? "ephemeral",
        standard: compactStandard(rule.guidance),
        enabled: file ? ruleEnabledForFile(config, file, rule.id) : true,
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  });
});
