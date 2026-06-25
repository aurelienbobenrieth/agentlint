import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { defineConfig } from "vitest/config";

const PackageJson = Schema.Struct({
  version: Schema.String,
});
const PackageJsonFromString = Schema.decodeUnknownSync(Schema.fromJsonString(PackageJson));
const pkg = PackageJsonFromString(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf-8"));

export default defineConfig({
  define: {
    __AGENTLINT_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    pool: "forks",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
