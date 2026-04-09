import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname!, "package.json"), "utf-8"));

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
