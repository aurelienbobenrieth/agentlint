import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
    pool: "forks",
    maxWorkers: 4,
    testTimeout: 30_000,
  },
});
