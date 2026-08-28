import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

const structuredEffectErrors = defineRule({
  lifecycle: "state",
  standard: {
    id: "effect/structured-errors",
    revision: 1,
    title: "Effect errors expose structured failure data",
    guidance: {
      standard:
        "Tagged errors carry structured fields and derive their message. A stringly message field hides the failure shape from callers and telemetry.",
      checks: [
        "Represent the failure with reason literals, identifiers, paths, or other structured fields.",
        "Derive the human-readable message with a getter.",
      ],
      examples: [
        {
          label: "Structured tagged error",
          code: 'class E extends Schema.TaggedErrorClass<E>()("app/E", { reason: Schema.Literals(["io", "parse"]), detail: Schema.String }) { override get message() { return `${this.reason}: ${this.detail}` } }',
        },
      ],
    },
    source: { type: "file", path: "AGENTS.md" },
  },
  detector: {
    id: "typescript/tagged-error-message-field",
    version: 1,
    match: {
      pattern: "Schema.TaggedErrorClass<$T>()($TAG, $FIELDS)",
      where: { has: "message: Schema.String" },
      message: "Tagged error $TAG declares a stringly message field.",
    },
    fixtures: {
      mustReport: ['class E extends Schema.TaggedErrorClass<E>()("E", { message: Schema.String }) {}'],
      mustStaySilent: [
        'class E extends Schema.TaggedErrorClass<E>()("app/E", { reason: Schema.Literals(["io"]), detail: Schema.String }) {}',
      ],
    },
  },
  binding: {
    id: "effect/structured-errors",
    authority: "agent",
    include: ["packages/agentlint/src/**/*.ts"],
    exclude: ["**/*.test.ts", "**/__fixtures__/**"],
  },
});

const processBoundary = defineRule({
  lifecycle: "state",
  standard: {
    id: "boundaries/process-access",
    revision: 1,
    title: "Process access stays behind Env",
    guidance: {
      standard:
        "src/config/env.ts is the only module that touches process.*. Other modules depend on Env so runtime state stays explicit and testable.",
      checks: ["Add a field to Env when a runtime value is missing.", "Inject Env instead of reading a global."],
      examples: [{ code: "const env = yield* Env\nconst directory = env.cwd" }],
    },
    source: { type: "file", path: "AGENTS.md" },
  },
  detector: {
    id: "typescript/direct-process-access",
    version: 1,
    createOnce(context) {
      return {
        member_expression(node) {
          const object = node.childByFieldName("object");
          if (object?.type !== "identifier" || object.text !== "process") return;
          if (node.parent?.type === "member_expression") return;
          context.report({ node, message: `Direct process access: ${node.text.split("\n")[0]}` });
        },
      };
    },
    fixtures: {
      mustReport: ["const directory = process.cwd()"],
      mustStaySilent: ["const directory = env.cwd", "const directory = myprocess.cwd()"],
    },
  },
  binding: {
    id: "boundaries/process-access",
    authority: "agent",
    include: ["packages/agentlint/src/**/*.ts"],
    exclude: ["packages/agentlint/src/config/env.ts", "**/*.test.ts", "**/__fixtures__/**"],
  },
});

export default defineConfig({
  rules: [structuredEffectErrors, processBoundary],
  ignores: ["dist/**", "coverage/**", "**/node_modules/**", ".agents/**"],
});
