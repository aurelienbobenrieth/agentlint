import { resolve } from "node:path";
import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [foldkit()],
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
