import { describe, expect, it } from "vitest";
import { agentMarkFor } from "./agents";

describe("agentMarkFor", () => {
  it("recognises agents by the product or model names they sign with", () => {
    expect(
      [
        "claude",
        "Claude Code",
        "codex",
        "gpt-5",
        "gemini-cli",
        "grok-4",
        "devstral",
        "github-copilot",
        "cursor-agent",
      ].map(agentMarkFor),
    ).toEqual(["claude", "claude", "openai", "openai", "gemini", "grok", "mistral", "githubcopilot", "cursor"]);
  });

  it("leaves unknown names and words that merely contain a vendor fragment unmarked", () => {
    expect(["aurelien", "ci-bot", "metadata-sync", "egpt"].map(agentMarkFor)).toEqual([null, null, null, null]);
  });
});
