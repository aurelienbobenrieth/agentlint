import { defineConfig, defineRule } from "../../../src/index.js";

const noNoiseComments = defineRule({
  id: "comments/no-noise",
  description: "Flags comments for guidance.",
  guidance: "Comments should add durable context beyond the code.",
  createOnce(context) {
    return {
      comment(node) {
        const text = node.text.replace(/^\/\/\s*/, "").trim();
        if (text.length === 0) return;
        context.report({ node, message: `Comment: "${text.slice(0, 60)}"` });
      },
    };
  },
});

export default defineConfig({
  rules: {
    "comments/no-noise": noNoiseComments,
  },
  files: ["src/**/*.{ts,tsx}"],
});
