#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const tarball = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!tarball || !existsSync(tarball)) {
  throw new Error("Usage: node scripts/smoke-package.mjs <package.tgz>");
}

const root = mkdtempSync(join(tmpdir(), "agentlint-package-smoke-"));
const npm = "npm";
const bin = join(root, "node_modules", "@aurelienbbn", "agentlint", "dist", "bin.mjs");
const env = { ...process.env, PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` };

function run(command, args, expected = 0, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: "pipe" });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== expected) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}; expected ${expected}`);
  }
}

try {
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "agentlint-package-smoke", private: true }));
  run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball]);

  run(process.execPath, [bin, "init"]);
  writeFileSync(
    join(root, ".agentlint", "config.ts"),
    `import { defineConfig, defineRule } from "@aurelienbbn/agentlint";
const rule = defineRule({
  id: "smoke/comment",
  description: "Package smoke rule.",
  guidance: { standard: "TODO comments carry an owner.", checks: ["Confirm the TODO has an owner."] },
  fixtures: { invalid: ["// TODO: later"], valid: ["// TODO(owner): later"] },
  createOnce(context) { return { comment(node) { if (node.text.includes("TODO:")) context.report({ node, message: "TODO needs an owner." }); } }; },
});
export default defineConfig({ rules: { "smoke/comment": rule }, files: ["src/**/*.ts"] });
`,
  );
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "smoke.ts"), "// TODO: later\nexport const value = true;\n");

  run(process.execPath, [bin, "rules", "test"]);
  run(process.execPath, [bin, "check", "--all"], 1);
  run(process.execPath, [bin, "explain", "1"]);
  run(process.execPath, [bin, "resolve", "1", "--accept", "--reason", "Package smoke disposition."]);
  run(process.execPath, [bin, "check", "--all"]);

  for (const required of ["dist/bin.mjs", "dist/ui/index.html", "dist/wasm/tree-sitter.wasm"]) {
    if (!existsSync(join(root, "node_modules", "@aurelienbbn", "agentlint", required))) {
      throw new Error(`Packed artifact is missing ${required}`);
    }
  }
  console.log("Package smoke test passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
