import { defineConfig, defineRule } from "../../../src/index.js";

const noNoiseComments = defineRule({
  lifecycle: "state",
  standard: {
    id: "comments/durable-context",
    revision: 1,
    title: "Comments add durable context",
    guidance: "Comments explain intent the code cannot express on its own.",
  },
  detector: {
    id: "typescript/non-empty-comments",
    version: 1,
    createOnce(context) {
      return {
        comment(node) {
          const text = node.text.replace(/^\/\/\s*/, "").trim();
          if (text) context.report({ node, message: `Review comment: ${text.slice(0, 60)}` });
        },
      };
    },
  },
  binding: { id: "comments/no-noise", authority: "agent", include: ["src/**/*.{ts,tsx}"] },
});

export default defineConfig({ rules: [noNoiseComments] });
