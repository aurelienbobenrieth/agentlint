import { defineConfig, defineRule } from "../../../src/index.js";

const noiseComments = defineRule({
  meta: {
    name: "no-noise-comments",
    description: "Flags comments for AI evaluation",
    languages: ["ts", "tsx"],
    instruction: `Evaluate each comment. Remove noise, keep valuable ones.`,
  },
  createOnce(context) {
    return {
      comment(node) {
        const text = node.text.replace(/^\/\/\s*/, "").trim();
        if (text === "" || text.startsWith("agentlint-ignore")) return;
        context.flag({ node, message: `Comment: "${text.slice(0, 60)}"` });
      },
    };
  },
});

export default defineConfig({
  rules: {
    "no-noise-comments": noiseComments,
  },
});
