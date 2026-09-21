/** Minimal, non-destructive repository initialization. @module @since 0.2.0 */

import { Effect, FileSystem, Path } from "effect";
import { Env } from "../../config/env.js";
import { InitCommand, InitPresetError, InitResult } from "./request.js";

const STARTER_CONFIG = `import { defineConfig } from "@aurelienbbn/agentlint"

export default defineConfig({
  rules: [],
  ignores: ["dist/**", "coverage/**"],
})
`;

export const initHandler = Effect.fn("initHandler")(function* (command: InitCommand) {
  const presets: { module: string; name: string }[] = [];
  for (const preset of new Set(command.presets ?? [])) {
    const match = /^(?<module>(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)#(?<name>[A-Za-z_$][\w$]*)$/u.exec(
      preset,
    );
    const module = match?.groups?.module;
    const name = match?.groups?.name;
    if (!module || !name) return yield* new InitPresetError({ preset });
    presets.push({ module, name });
  }
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.resolve(env.cwd, ".agentlint");
  const configPath = path.resolve(directory, "config.ts");
  const gitignorePath = path.resolve(env.cwd, ".gitignore");
  const created = !(yield* fs.exists(configPath));
  if (created) {
    yield* fs.makeDirectory(directory, { recursive: true });
    const config =
      presets.length === 0
        ? STARTER_CONFIG
        : [
            'import { defineConfig } from "@aurelienbbn/agentlint"',
            ...presets.map(
              (preset, index) => `import { ${preset.name} as preset${index} } from ${JSON.stringify(preset.module)}`,
            ),
            "",
            "export default defineConfig({",
            `  extends: [${presets.map((_, index) => `preset${index}`).join(", ")}],`,
            '  ignores: ["dist/**", "coverage/**"],',
            "})",
            "",
          ].join("\n");
    yield* fs.writeFileString(configPath, config);
  }

  const cacheEntry = ".agentlint/.cache/";
  const ephemeralEntries = [cacheEntry, ".agentlint/*.lock", ".agentlint/*.lock.*.stale", ".agentlint/*.tmp"];
  // Only a missing file starts empty. An unreadable .gitignore must fail instead of being replaced.
  const currentIgnore = (yield* fs.exists(gitignorePath)) ? yield* fs.readFileString(gitignorePath) : "";
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
      ...(presets.length && created
        ? [
            `Install the selected packages: pnpm add -D ${[...new Set(presets.map((preset) => preset.module))].join(" ")}`,
            "Then: agentlint rules test → agentlint rules scan --review → agentlint next",
            "Review the selected standards and scopes before enforcing agentlint check --all in CI.",
          ]
        : [
            "Next: define one repository rule, run `agentlint rules test`, then `agentlint check --all`.",
            "Or start with a chosen plugin: agentlint init --preset <package>#<export> (in a repository without a config).",
          ]),
    ].join("\n"),
  });
});
