import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
    pool: "forks",
    testTimeout: 30_000,
  },
});
