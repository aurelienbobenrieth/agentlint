import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

const ownedTodo = defineRule({
  id: "docs/owned-todo",
  description: "Flags TODO comments without an owner.",
  guidance: {
    standard: "TODOs carry an owner or ticket.",
    checks: ["Use TODO(name) or TODO(PROJECT-123)."],
  },
  createOnce(context) {
    return {
      comment(node) {
        if (/\bTODO\b/.test(node.text) && !/\bTODO\([^)]+\)/.test(node.text)) {
          context.report({ node, message: "TODO needs an owner or ticket." });
        }
      },
    };
  },
  fixtures: {
    invalid: ["// TODO: paginate"],
    valid: ["// TODO(PROJECT-123): paginate"],
  },
});

export default defineConfig({
  files: ["src/**/*.ts"],
  rules: { "docs/owned-todo": ownedTodo },
});
