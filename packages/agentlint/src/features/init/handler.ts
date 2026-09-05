/** Minimal, non-destructive repository initialization. @module @since 0.2.0 */

import { Effect, FileSystem, Path } from "effect";
import { Env } from "../../config/env.js";
import { InitCommand, InitResult } from "./request.js";

const STARTER_CONFIG = `import { defineConfig } from "@aurelienbbn/agentlint"

export default defineConfig({
  rules: [],
  ignores: ["dist/**", "coverage/**"],
})
`;

export const initHandler = Effect.fn("initHandler")(function* (_command: InitCommand) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.resolve(env.cwd, ".agentlint");
  const configPath = path.resolve(directory, "config.ts");
  const gitignorePath = path.resolve(env.cwd, ".gitignore");
  const created = !(yield* fs.exists(configPath));
  if (created) {
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(configPath, STARTER_CONFIG);
  }

  const cacheEntry = ".agentlint/.cache/";
  const ephemeralEntries = [cacheEntry, ".agentlint/acceptances.lock", ".agentlint/acceptances.*.tmp"];
  const currentIgnore = yield* fs.readFileString(gitignorePath).pipe(Effect.orElseSucceed(() => ""));
  const missingEntries = ephemeralEntries.filter((entry) => !currentIgnore.split(/\r?\n/).includes(entry));
  const ignoreUpdated = missingEntries.length > 0;
  if (ignoreUpdated) {
    const prefix = currentIgnore.length === 0 || currentIgnore.endsWith("\n") ? currentIgnore : `${currentIgnore}\n`;
    yield* fs.writeFileString(
      gitignorePath,
      `${prefix}\n# agentlint ephemeral selector cache\n${missingEntries.join("\n")}\n`,
    );
  }

  return new InitResult({
    created,
    message: [
      created ? "Created .agentlint/config.ts." : "Kept existing .agentlint/config.ts.",
      ignoreUpdated ? "Ignored .agentlint/.cache/." : "Selector cache is already ignored.",
      "",
      "Next: define one repository rule, run `agentlint rules test`, then `agentlint check --all`.",
    ].join("\n"),
  });
});
