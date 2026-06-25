import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf-8"));

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
