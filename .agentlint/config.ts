import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

/**
 * Dogfood configuration: agentlint checking agentlint.
 *
 * These rules encode the conventions from AGENTS.md that a classic linter
 * cannot arbitrate: each trigger is deterministic, but whether a given match
 * is acceptable needs judgment, so resolutions land in the committed ledger.
 */

const noStringlyErrorMessage = defineRule({
  id: "effect/no-stringly-error-message",
  description: "Flags tagged errors that declare a stringly message field instead of structured fields.",
  guidance: {
    standard:
      "Tagged errors carry structured fields with a derived message getter. A message: Schema.String field loses the discriminant for programmatic handling and hides the failure shape from telemetry.",
    checks: [
      "Replace free-text message fields with discriminant fields (reason literals, ids, paths) and an override get message().",
      "A message field is acceptable when the text itself is the domain payload (e.g. a user-authored reason).",
    ],
    examples: [
      {
        label: "Structured error",
        bad: 'Schema.TaggedErrorClass<E>()("E", { message: Schema.String })',
        good: 'Schema.TaggedErrorClass<E>()("app/E", { reason: Schema.Literals(["io", "parse"]), detail: Schema.String })',
      },
    ],
  },
  match: [
    {
      pattern: "Schema.TaggedErrorClass<$T>()($TAG, $FIELDS)",
      where: { has: "message: Schema.String" },
      message: "Tagged error $TAG declares a stringly message field; prefer structured fields with a message getter.",
    },
  ],
  fixtures: {
    file: "fixture.ts",
    invalid: ['class E extends Schema.TaggedErrorClass<E>()("E", { message: Schema.String }) {}'],
    valid: [
      'class E extends Schema.TaggedErrorClass<E>()("app/E", { reason: Schema.Literals(["io"]), detail: Schema.String }) {}',
    ],
  },
});

const noDirectProcess = defineRule({
  id: "boundaries/no-direct-process",
  description: "Flags direct process.* access outside the Env service.",
  guidance: {
    standard:
      "src/config/env.ts is the only module that may touch process.*. Everything else depends on the Env service so tests can inject cwd, actor, platform, and exit codes.",
    checks: [
      "Route the value through the Env service (add a field there if missing).",
      "Direct access is acceptable in runtime bootstrap code that cannot depend on Env.",
    ],
  },
  createOnce(context) {
    return {
      before(filename) {
        return !filename.replace(/\\/g, "/").endsWith("src/config/env.ts");
      },
      member_expression(node) {
        const object = node.childByFieldName("object");
        if (object?.type !== "identifier" || object.text !== "process") return;
        // Only the outermost member expression of a chain reports.
        if (node.parent?.type === "member_expression") return;
        context.report({ node, message: `Direct process access: ${node.text.split("\n")[0]}` });
      },
    };
  },
  fixtures: {
    file: "fixture.ts",
    invalid: ["const dir = process.cwd();"],
    valid: ["const dir = env.cwd;", "const p = myprocess.cwd();"],
  },
});

export default defineConfig({
  rules: {
    "effect/no-stringly-error-message": noStringlyErrorMessage,
    "boundaries/no-direct-process": noDirectProcess,
  },
  policy: {
    "effect/no-stringly-error-message": { persistence: "durable" },
    "boundaries/no-direct-process": { persistence: "durable" },
  },
  files: ["packages/agentlint/src/**/*.ts"],
  ignores: ["**/*.test.ts", "**/__fixtures__/**"],
  notes: { dirs: [".agents/learn"] },
});
