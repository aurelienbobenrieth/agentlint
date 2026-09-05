import { resolve } from "node:path";
import { foldkit } from "@foldkit/vite-plugin";
import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// The `source` condition resolves `@aurelienbbn/agentlint/contract` to the
// workspace TypeScript file, so dev, tests, and the build never need `dist/`.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [foldkit()],
  resolve: {
    conditions: ["source", ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: ["source", ...defaultServerConditions],
    },
  },
  test: {
    server: {
      deps: {
        inline: ["@aurelienbbn/agentlint"],
      },
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, "..", "..", "packages", "agentlint", "dist", "ui"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:4973",
    },
  },
});
