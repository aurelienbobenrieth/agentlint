/**
 * @module
 * @since 0.1.0
 */

import { Effect, FileSystem, Path } from "effect";
import { Env } from "../../config/env.js";
import { InitCommand, InitResult } from "./request.js";

/**
 * Minimal starter config written by `agentlint init`.
 *
 * @since 0.1.0
 * @category constants
 */
const STARTER_CONFIG = `import { defineConfig } from "agentlint"

export default defineConfig({
  include: ["src/**/*.{ts,tsx}"],
  rules: {},
})
`;

const SKILLS_ADD_CMD = "npx skills@latest add aurelienbobenrieth/agentlint";
const INTENT_INSTALL_CMD = "npx @tanstack/intent install";

/**
 * Detect which skill installation method is most likely appropriate.
 *
 * Checks for TanStack Intent or existing AGENTS.md with intent block.
 */
const detectSkillMethod = Effect.fn("detectSkillMethod")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // Check if TanStack Intent is installed
  const hasIntent = yield* fs
    .exists(path.resolve(cwd, "node_modules/@tanstack/intent"))
    .pipe(Effect.orElseSucceed(() => false));

  if (hasIntent) return "intent" as const;

  // Check if AGENTS.md has an intent-skills block (installed by intent previously)
  const agentsPath = path.resolve(cwd, "AGENTS.md");
  if (yield* fs.exists(agentsPath)) {
    const content = yield* fs.readFileString(agentsPath);
    if (content.includes("intent-skills:start")) return "intent" as const;
  }

  return "skills" as const;
});

/** @since 0.1.0 */
export const initHandler = Effect.fn("initHandler")(function* (_command: InitCommand) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configPath = path.resolve(env.cwd, "agentlint.config.ts");

  const gitignorePath = path.resolve(env.cwd, ".gitignore");

  // --- Step 1: Create config ---
  const configCreated = !(yield* fs.exists(configPath));
  if (configCreated) {
    yield* fs.writeFileString(configPath, STARTER_CONFIG);
  }

  // --- Step 2: Ensure .agentlint-state is gitignored ---
  let gitignoreUpdated = false;
  const gitignoreExists = yield* fs.exists(gitignorePath);
  if (gitignoreExists) {
    const content = yield* fs.readFileString(gitignorePath);
    if (!content.includes(".agentlint-state")) {
      const separator = content.endsWith("\n") ? "" : "\n";
      yield* fs.writeFileString(gitignorePath, content + separator + "\n# agentlint local state\n.agentlint-state\n");
      gitignoreUpdated = true;
    }
  } else {
    yield* fs.writeFileString(gitignorePath, "# agentlint local state\n.agentlint-state\n");
    gitignoreUpdated = true;
  }

  const lines: Array<string> = [];

  if (configCreated) {
    lines.push("✓ Created agentlint.config.ts");
  } else {
    lines.push("· agentlint.config.ts already exists — skipped");
  }

  if (gitignoreUpdated) {
    lines.push("✓ Added .agentlint-state to .gitignore");
  }

  // --- Step 2: Next steps ---
  const method = yield* detectSkillMethod(env.cwd);
  const skillCmd = method === "intent" ? INTENT_INSTALL_CMD : SKILLS_ADD_CMD;

  lines.push(
    "",
    "Next steps:",
    "  1. Add rules to your config",
    `  2. Install the agentlint skill for your AI agents:`,
    `     ${skillCmd}`,
    "  3. Run: npx agentlint check --all",
  );

  return new InitResult({
    created: configCreated,
    message: lines.join("\n"),
  });
});
