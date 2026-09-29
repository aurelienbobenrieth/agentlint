import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { defineConfig } from "tsdown";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PackageJson = Schema.Struct({
  version: Schema.String,
});
const PackageJsonFromString = Schema.decodeUnknownSync(Schema.fromJsonString(PackageJson));
const encodeString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.String));
const pkg = PackageJsonFromString(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    calibration: "src/features/calibration/report.ts",
    contract: "src/features/review/contract.ts",
    index: "src/index.ts",
    testing: "src/testing.ts",
  },
  format: "esm",
  dts: true,
  sourcemap: true,
  define: {
    __AGENTLINT_VERSION__: encodeString(pkg.version),
  },
  hooks: {
    "build:done": async () => {
      const wasmDir = resolve(__dirname, "dist/wasm");
      mkdirSync(wasmDir, { recursive: true });

      // Copy web-tree-sitter core WASM
      const treeSitterWasm = resolve(__dirname, "node_modules/web-tree-sitter/tree-sitter.wasm");
      if (existsSync(treeSitterWasm)) {
        cpSync(treeSitterWasm, resolve(wasmDir, "tree-sitter.wasm"));
      } else throw new Error(`Required parser asset is missing: ${treeSitterWasm}`);

      // Copy language grammars. TSX from tree-sitter-typescript 0.23.2, since the 0.20 build in tree-sitter-wasms rejects
      // `&` in JSX string attributes; the rest from tree-sitter-wasms, since TypeScript 0.23.2 rejects a tagged template
      // with an object type argument (see Parser)
      const grammars = [
        "tree-sitter-wasms/out/tree-sitter-typescript.wasm",
        "tree-sitter-typescript/tree-sitter-tsx.wasm",
        "tree-sitter-wasms/out/tree-sitter-javascript.wasm",
        "tree-sitter-wasms/out/tree-sitter-json.wasm",
      ];
      for (const grammar of grammars) {
        const src = resolve(__dirname, `node_modules/${grammar}`);
        if (existsSync(src)) {
          cpSync(src, resolve(wasmDir, basename(grammar)));
        } else throw new Error(`Required grammar asset is missing: ${src}`);
      }

      console.log("WASM files copied to dist/wasm/");
    },
  },
});
