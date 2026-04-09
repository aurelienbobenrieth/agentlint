/**
 * Tree-sitter WASM parser.
 *
 * WASM init is lazy — the first `parse` call triggers initialization.
 * Grammars are cached after first load.
 *
 * @module
 * @since 0.1.0
 */

import { Effect, FileSystem, HashMap, Layer, Option, Path, Schema } from "effect";
import * as ServiceMap from "effect/ServiceMap";
import { Env } from "../../config/env.js";
import { Language, Parser as TSParser, type Tree } from "web-tree-sitter";

/**
 * Raised when parsing fails — e.g. missing grammar, corrupt WASM, or
 * tree-sitter returning a null tree.
 *
 * @since 0.1.0
 * @category errors
 */
export class ParserError extends Schema.TaggedErrorClass<ParserError>()("ParserError", {
  message: Schema.String,
}) {}

/**
 * Maps grammar names to their corresponding `.wasm` filenames.
 *
 * @since 0.1.0
 * @category constants
 */
const GRAMMAR_FILES: HashMap.HashMap<string, string> = HashMap.make(
  ["typescript", "tree-sitter-typescript.wasm"],
  ["tsx", "tree-sitter-tsx.wasm"],
  ["javascript", "tree-sitter-javascript.wasm"],
);

/**
 * @example
 * ```ts
 * import { Console, Effect } from "effect"
 * import { Parser } from "./infrastructure/parser.js"
 *
 * const program = Effect.gen(function* () {
 *   const parser = yield* Parser
 *   const tree = yield* parser.parse("const x = 1", "typescript")
 *   yield* Console.log(tree.rootNode.type) // "program"
 * })
 * ```
 *
 * @since 0.1.0
 * @category services
 */
export class Parser extends ServiceMap.Service<
  Parser,
  {
    parse(source: string, grammar: string): Effect.Effect<Tree, ParserError>;
  }
>()("agentlint/Parser") {
  /** Default layer — lazily initializes WASM and caches grammars. */
  static readonly layer: Layer.Layer<Parser, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    Parser,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const resolveWasmPath = (filename: string): Effect.Effect<string, ParserError> =>
        Effect.gen(function* () {
          const thisDir = path.dirname(path.resolve(import.meta.dirname ?? ".", ""));
          const distPath = path.resolve(thisDir, "wasm", filename);
          if (yield* fs.exists(distPath).pipe(Effect.orElseSucceed(() => false))) return distPath;

          const nmBase = path.resolve(env.cwd, "node_modules");
          if (filename === "tree-sitter.wasm") {
            const p = path.resolve(nmBase, "web-tree-sitter", filename);
            if (yield* fs.exists(p).pipe(Effect.orElseSucceed(() => false))) return p;
          } else {
            const p = path.resolve(nmBase, "tree-sitter-wasms", "out", filename);
            if (yield* fs.exists(p).pipe(Effect.orElseSucceed(() => false))) return p;
          }

          return yield* new ParserError({ message: `WASM file not found: ${filename}` });
        });

      let parserInstance: TSParser | undefined;
      let languageCache: HashMap.HashMap<string, Language> = HashMap.empty();

      return Parser.of({
        parse: (source, grammar) =>
          Effect.gen(function* () {
            if (!parserInstance) {
              const initPath = yield* resolveWasmPath("tree-sitter.wasm");
              yield* Effect.tryPromise({
                try: async () => {
                  await TSParser.init({ locateFile: () => initPath });
                  parserInstance = new TSParser();
                },
                catch: (error) => new ParserError({ message: error instanceof Error ? error.message : String(error) }),
              });
            }

            let lang = Option.getOrUndefined(HashMap.get(languageCache, grammar));
            if (!lang) {
              const file = Option.getOrUndefined(HashMap.get(GRAMMAR_FILES, grammar));
              if (!file) return yield* new ParserError({ message: `Unknown grammar: ${grammar}` });

              const wasmPath = yield* resolveWasmPath(file);
              lang = yield* Effect.tryPromise({
                try: () => Language.load(wasmPath),
                catch: (error) => new ParserError({ message: error instanceof Error ? error.message : String(error) }),
              });
              languageCache = HashMap.set(languageCache, grammar, lang);
            }

            parserInstance!.setLanguage(lang);
            const tree = parserInstance!.parse(source);
            if (!tree) return yield* new ParserError({ message: "Parser returned null tree" });
            return tree;
          }),
      });
    }),
  );
}
