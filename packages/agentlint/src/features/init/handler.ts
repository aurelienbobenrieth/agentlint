/**
 * @module
 * @since 0.1.0
 */

import { Effect, FileSystem, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import { InitCommand, InitResult } from "./request.js";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const PackageJson = Schema.Struct({
  packageManager: Schema.optional(Schema.String),
});
const PackageJsonFromString = Schema.decodeUnknownSync(Schema.fromJsonString(PackageJson));

/**
 * Minimal starter config written by `agentlint init`.
 *
 * @since 0.1.0
 * @category constants
 */
const STARTER_CONFIG = `import { defineConfig } from "@aurelienbbn/agentlint"

export default defineConfig({
  rules: {},
  files: ["src/**/*.{ts,tsx,js,jsx}"],
  ignores: [],
})
`;

function packageManagerFromValue(value: string | undefined): PackageManager | undefined {
  if (!value) return undefined;
  if (value.startsWith("pnpm@")) return "pnpm";
  if (value.startsWith("yarn@")) return "yarn";
  if (value.startsWith("bun@")) return "bun";
  if (value.startsWith("npm@")) return "npm";
  return undefined;
}

function commandsForPackageManager(packageManager: PackageManager) {
  switch (packageManager) {
    case "pnpm":
      return {
        skillInstall: "pnpm dlx skills@latest add aurelienbobenrieth/agentlint",
        intentInstall: "pnpm dlx @tanstack/intent install",
        agentlintCheck: "pnpm agentlint check --all",
      };
    case "yarn":
      return {
        skillInstall: "yarn dlx skills@latest add aurelienbobenrieth/agentlint",
        intentInstall: "yarn dlx @tanstack/intent install",
        agentlintCheck: "yarn agentlint check --all",
      };
    case "bun":
      return {
        skillInstall: "bunx skills@latest add aurelienbobenrieth/agentlint",
        intentInstall: "bunx @tanstack/intent install",
        agentlintCheck: "bun run agentlint check --all",
      };
    case "npm":
      return {
        skillInstall: "npx skills@latest add aurelienbobenrieth/agentlint",
        intentInstall: "npx @tanstack/intent install",
        agentlintCheck: "npm exec agentlint -- check --all",
      };
  }
}

const detectPackageManager = Effect.fn("detectPackageManager")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const packageJsonPath = path.resolve(cwd, "package.json");
  if (yield* fs.exists(packageJsonPath)) {
    const packageJson = yield* fs.readFileString(packageJsonPath).pipe(Effect.orElseSucceed(() => ""));
    try {
      const parsed = PackageJsonFromString(packageJson);
      const detected = packageManagerFromValue(parsed.packageManager);
      if (detected) return detected;
    } catch {
      // Ignore invalid package.json contents and fall back to lockfiles.
    }
  }

  const lockfiles: ReadonlyArray<readonly [string, PackageManager]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ];

  for (const [lockfile, packageManager] of lockfiles) {
    if (yield* fs.exists(path.resolve(cwd, lockfile))) {
      return packageManager;
    }
  }

  return "npm" as const;
});

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

/**
 * Claude Code PostToolUse hook: checks each edited file immediately and
 * feeds blocking findings back to the model, so activation does not depend
 * on the agent remembering to run check.
 */
const CLAUDE_CODE_HOOK_SETTINGS = {
  hooks: {
    PostToolUse: [
      {
        matcher: "Edit|Write|MultiEdit",
        hooks: [{ type: "command", command: "pnpm agentlint hook claude-code" }],
      },
    ],
  },
};

const PRE_COMMIT_SNIPPET = `#!/bin/sh
# agentlint gate: block commits with unresolved findings.
pnpm agentlint check || {
  echo "agentlint: fix the findings or record dispositions, then commit again." >&2
  exit 1
}
`;

const writeHarnessSnippets = Effect.fn("writeHarnessSnippets")(function* (harness: string, cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lines: string[] = [];

  if (harness === "claude-code") {
    const settingsPath = path.resolve(cwd, ".claude", "settings.json");
    if (yield* fs.exists(settingsPath).pipe(Effect.orElseSucceed(() => false))) {
      lines.push("· .claude/settings.json already exists - merge this hook into it:");
      lines.push(JSON.stringify(CLAUDE_CODE_HOOK_SETTINGS, null, 2));
    } else {
      yield* fs.makeDirectory(path.resolve(cwd, ".claude"), { recursive: true });
      yield* fs.writeFileString(settingsPath, JSON.stringify(CLAUDE_CODE_HOOK_SETTINGS, null, 2) + "\n");
      lines.push("✓ Created .claude/settings.json with a PostToolUse hook (agentlint hook claude-code)");
    }
    return lines;
  }

  if (harness === "pre-commit") {
    const hookPath = path.resolve(cwd, ".agentlint", "harness", "pre-commit");
    yield* fs.makeDirectory(path.resolve(cwd, ".agentlint", "harness"), { recursive: true });
    yield* fs.writeFileString(hookPath, PRE_COMMIT_SNIPPET);
    lines.push("✓ Wrote .agentlint/harness/pre-commit");
    lines.push("  Install it with: cp .agentlint/harness/pre-commit .git/hooks/pre-commit");
    lines.push("  (or reference it from husky/lefthook)");
    return lines;
  }

  lines.push(`Unknown harness "${harness}". Supported: claude-code, pre-commit.`);
  return lines;
});

/** @since 0.1.0 */
export const initHandler = Effect.fn("initHandler")(function* (command: InitCommand) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configDir = path.resolve(env.cwd, ".agentlint");
  const rulesDir = path.resolve(configDir, "rules");
  const configPath = path.resolve(configDir, "config.ts");

  const gitignorePath = path.resolve(env.cwd, ".gitignore");

  const configCreated = !(yield* fs.exists(configPath));
  if (configCreated) {
    yield* fs.makeDirectory(configDir, { recursive: true });
    yield* fs.writeFileString(configPath, STARTER_CONFIG);
  }

  const rulesCreated = !(yield* fs.exists(rulesDir));
  if (rulesCreated) {
    yield* fs.makeDirectory(rulesDir, { recursive: true });
  }

  // --- Step 2: Ensure selector cache is gitignored ---
  let gitignoreUpdated = false;
  const gitignoreExists = yield* fs.exists(gitignorePath);
  if (gitignoreExists) {
    const content = yield* fs.readFileString(gitignorePath);
    if (!content.includes(".agentlint/.cache/")) {
      const separator = content.endsWith("\n") ? "" : "\n";
      yield* fs.writeFileString(
        gitignorePath,
        content + separator + "\n# agentlint ephemeral selector cache\n.agentlint/.cache/\n",
      );
      gitignoreUpdated = true;
    }
  } else {
    yield* fs.writeFileString(gitignorePath, "# agentlint ephemeral selector cache\n.agentlint/.cache/\n");
    gitignoreUpdated = true;
  }

  const lines: Array<string> = [];

  if (configCreated) {
    lines.push("✓ Created .agentlint/config.ts");
  } else {
    lines.push("· .agentlint/config.ts already exists - skipped");
  }

  if (rulesCreated) {
    lines.push("✓ Created .agentlint/rules/");
  }

  if (gitignoreUpdated) {
    lines.push("✓ Added .agentlint/.cache/ to .gitignore");
  }

  if (command.harness) {
    lines.push(...(yield* writeHarnessSnippets(command.harness, env.cwd)));
  }

  // --- Step 2: Next steps ---
  const packageManager = yield* detectPackageManager(env.cwd);
  const commands = commandsForPackageManager(packageManager);
  const method = yield* detectSkillMethod(env.cwd);
  const skillCmd = method === "intent" ? commands.intentInstall : commands.skillInstall;

  lines.push(
    "",
    "Next steps:",
    "  1. Add rules to your config",
    `  2. Install the agentlint skill for your AI agents:`,
    `     ${skillCmd}`,
    `  3. Run: ${commands.agentlintCheck}`,
  );

  return new InitResult({
    created: configCreated,
    message: lines.join("\n"),
  });
});
