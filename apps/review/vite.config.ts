import { resolve } from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    tailwindcss(),
    paraglideVitePlugin({
      project: resolve(__dirname, "project.inlang"),
      outdir: resolve(__dirname, "src", "paraglide"),
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@ui": resolve(__dirname, "..", "..", "packages", "ui", "src"),
    },
  },
  build: {
    outDir: resolve(__dirname, "..", "..", "dist", "ui"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:4973",
    },
  },
});
