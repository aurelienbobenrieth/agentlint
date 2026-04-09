import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    index: "src/index.ts",
  },
  format: "esm",
  dts: true,
  sourcemap: true,
  define: {
    __AGENTLINT_VERSION__: JSON.stringify(pkg.version),
  },
  hooks: {
    "build:done": async () => {
      const wasmDir = resolve(__dirname, "dist/wasm");
      mkdirSync(wasmDir, { recursive: true });

      // Copy web-tree-sitter core WASM
      const treeSitterWasm = resolve(__dirname, "node_modules/web-tree-sitter/tree-sitter.wasm");
      if (existsSync(treeSitterWasm)) {
        cpSync(treeSitterWasm, resolve(wasmDir, "tree-sitter.wasm"));
      }

      // Copy language grammars from tree-sitter-wasms
      const grammars = ["tree-sitter-typescript.wasm", "tree-sitter-tsx.wasm", "tree-sitter-javascript.wasm"];
      for (const grammar of grammars) {
        const src = resolve(__dirname, `node_modules/tree-sitter-wasms/out/${grammar}`);
        if (existsSync(src)) {
          cpSync(src, resolve(wasmDir, grammar));
        }
      }

      console.log("WASM files copied to dist/wasm/");
    },
  },
});
