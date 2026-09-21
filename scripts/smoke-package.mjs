#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const tarball = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!tarball || !existsSync(tarball)) {
  throw new Error("Usage: node scripts/smoke-package.mjs <package.tgz>");
}

const root = mkdtempSync(join(tmpdir(), "agentlint-package-smoke-"));
const npm = process.platform === "win32" ? process.execPath : "npm";
const npmPrefix =
  process.platform === "win32" ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];
const bin = join(root, "node_modules", "@aurelienbbn", "agentlint", "dist", "bin.mjs");
const env = { ...process.env, PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` };

function run(command, args, expected = 0, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: "pipe" });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== expected) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}; expected ${expected}${result.error ? `: ${result.error.message}` : ""}`,
    );
  }
  return result.stdout;
}

try {
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "agentlint-package-smoke", private: true }));
  run(npm, [...npmPrefix, "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball, "typescript@7.0.2"]);

  run(process.execPath, [
    "--input-type=module",
    "-e",
    `
import { readFileSync } from "node:fs";
import { Schema } from "effect";
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
  exports: Schema.Record(Schema.String, Schema.Unknown)
})));
const installed = decode(readFileSync("node_modules/@aurelienbbn/agentlint/package.json", "utf8"));
if ("source" in installed.exports["./contract"]) throw new Error("Packed exports expose an absent workspace source file");
`,
  ]);
  writeFileSync(
    join(root, "consumer.mts"),
    `import { defineConfig, defineRule } from "@aurelienbbn/agentlint";
import { testRuleOnChange, testRuleOnSources } from "@aurelienbbn/agentlint/testing";
const rule = defineRule({ lifecycle: "change", standard: { id: "typed", revision: 1, title: "Typed", guidance: "Review" },
 detector: { id: "typed", version: 1, detect(context, options: { limit: number }) { if (options.limit < 0) throw new Error("limit"); } },
 binding: { id: "typed", authority: "agent", options: { limit: 5 } } });
defineConfig({ rules: [rule] });
void testRuleOnChange(rule, { before: {}, after: {} });
void testRuleOnSources;
`,
  );
  run(process.execPath, [
    join(root, "node_modules", "typescript", "bin", "tsc"),
    "consumer.mts",
    "--noEmit",
    "--strict",
    "--module",
    "NodeNext",
    "--target",
    "ESNext",
  ]);

  run(process.execPath, [bin, "init"]);
  writeFileSync(
    join(root, ".agentlint", "config.ts"),
    `import { defineConfig, defineRule } from "@aurelienbbn/agentlint";
const rule = defineRule({
  lifecycle: "state",
  standard: {
    id: "smoke/reviewed-danger-call",
    revision: 1,
    title: "Danger calls have explicit review",
    guidance: "Confirm that the danger call has an applicable sandbox.",
  },
  detector: {
    id: "typescript/danger-call",
    version: 1,
    match: { pattern: "danger($ARG)", message: "Danger call needs judgment." },
    fixtures: {
      mustReport: ["danger('later')"],
      mustStaySilent: ["safe('later')"],
    },
  },
  binding: { id: "smoke/reviewed-danger-call", authority: "agent", include: ["src/**/*.ts"] },
});
export default defineConfig({ rules: [rule] });
`,
  );
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "smoke.ts"), "danger('later');\n");

  run(process.execPath, [bin, "rules", "test"]);
  run(process.execPath, [bin, "check", "--all"], 1);
  const consumerRequire = createRequire(join(root, "package.json"));
  const { Schema } = await import(pathToFileURL(consumerRequire.resolve("effect")).href);
  const { NextResult } = await import(
    pathToFileURL(join(root, "node_modules", "@aurelienbbn", "agentlint", "dist", "contract.mjs")).href
  );
  const decodeNext = Schema.decodeUnknownSync(Schema.fromJsonString(NextResult));
  const handoff = decodeNext(run(process.execPath, [bin, "next", "--format", "json"], 1));
  if (
    handoff.version !== 1 ||
    handoff.remaining !== 1 ||
    handoff.scope !== "complete" ||
    handoff.actions[0]?.argv[0] !== "accept"
  )
    throw new Error("Invalid next handoff");
  run(process.execPath, [bin, "explain", "1"]);
  run(process.execPath, [bin, "accept", "1", "--reason", "The call runs inside the verified test sandbox."]);
  run(process.execPath, [bin, "check", "--all"]);

  const cleared = decodeNext(run(process.execPath, [bin, "next", "--format", "json"]));
  if (cleared.status !== "clear" || cleared.finding !== null) throw new Error("Accepted finding remained in next");
  const presetPackage = join(root, "node_modules", "agentlint-smoke-presets");
  mkdirSync(presetPackage, { recursive: true });
  writeFileSync(
    join(presetPackage, "package.json"),
    JSON.stringify({ name: "agentlint-smoke-presets", type: "module", exports: "./index.mjs" }),
  );
  writeFileSync(
    join(presetPackage, "index.mjs"),
    readFileSync(join(root, ".agentlint", "config.ts"), "utf8").replace(
      "export default defineConfig",
      "export const starterPreset = defineConfig",
    ),
  );
  const presetConsumer = join(root, "preset-consumer");
  mkdirSync(join(presetConsumer, "src"), { recursive: true });
  writeFileSync(join(presetConsumer, "src", "sample.ts"), "danger('preset');\n");
  run(process.execPath, [bin, "init", "--preset", "agentlint-smoke-presets#starterPreset"], 0, presetConsumer);
  run(process.execPath, [bin, "rules", "test"], 0, presetConsumer);
  run(process.execPath, [bin, "next", "--format", "json"], 1, presetConsumer);

  for (const required of [
    "dist/bin.mjs",
    "dist/calibration.mjs",
    "dist/ui/index.html",
    "dist/wasm/tree-sitter.wasm",
    "dist/wasm/tree-sitter-typescript.wasm",
    "dist/wasm/tree-sitter-tsx.wasm",
    "dist/wasm/tree-sitter-javascript.wasm",
    "dist/wasm/tree-sitter-json.wasm",
  ]) {
    if (!existsSync(join(root, "node_modules", "@aurelienbbn", "agentlint", required))) {
      throw new Error(`Packed artifact is missing ${required}`);
    }
  }
  console.log("Package smoke test passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
