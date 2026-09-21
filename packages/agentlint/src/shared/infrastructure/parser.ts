import { ParserError } from "../../domain/parser-error.js";
/**
 * Tree-sitter WASM parser.
 *
 * WASM init is lazy — the first `parse` call triggers initialization. Grammars are cached after first load.
 *
 * @module
 * @since 0.1.0
 */

import { Context, Effect, FileSystem, HashMap, Layer, Option, Path } from "effect";
import { Env } from "../../config/env.js";
import { Language, Parser as TSParser, type Tree } from "web-tree-sitter";

/**
 * Maps grammar names to their corresponding `.wasm` filenames.
 *
 * @since 0.1.0
 * @category Constants
 */
const GRAMMAR_FILES: HashMap.HashMap<string, string> = HashMap.make(
  ["typescript", "tree-sitter-typescript.wasm"],
  ["tsx", "tree-sitter-tsx.wasm"],
  ["javascript", "tree-sitter-javascript.wasm"],
  ["json", "tree-sitter-json.wasm"],
);

export function resolvePackagedWasmPath({
  path,
  dir,
  filename,
}: {
  readonly path: Pick<Path.Path, "resolve">;
  readonly dir: string;
  readonly filename: string;
}): string {
  return path.resolve(dir, "wasm", filename);
}

/**
 * @since 0.1.0
 * @category Services
 * @example
 *   ```ts
 *   import { Console, Effect } from "effect";
 *   import { Parser } from "./infrastructure/parser.js";
 *
 *   const program = Effect.gen(function* () {
 *     const parser = yield* Parser;
 *     const tree = yield* parser.parse({ source: "const x = 1", grammar: "typescript" });
 *     yield* Console.log(tree.rootNode.type); // "program"
 *   });
 *   ```;
 */
export class Parser extends Context.Service<
  Parser,
  {
    parse(input: { readonly source: string; readonly grammar: string }): Effect.Effect<Tree, ParserError>;
    /**
     * The loaded tree-sitter language used to construct queries.
     */
    language(grammar: string): Effect.Effect<Language, ParserError>;
  }
>()("agentlint/Parser") {
  /**
   * Default layer — lazily initializes WASM and caches grammars.
   */
  static readonly layer: Layer.Layer<Parser, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    Parser,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const resolveWasmPath = Effect.fn("Parser.resolveWasmPath")(function* (filename: string) {
        const thisDir = path.resolve(import.meta.dirname);
        const distPath = resolvePackagedWasmPath({ path, dir: thisDir, filename });
        if (yield* fs.exists(distPath).pipe(Effect.orElseSucceed(() => false))) return distPath;

        const dependencyRoots = [
          path.resolve(env.cwd, "node_modules"),
          path.resolve(thisDir, "..", "..", "..", "node_modules"),
        ];
        for (const nmBase of dependencyRoots) {
          if (filename === "tree-sitter.wasm") {
            const current = path.resolve(nmBase, "web-tree-sitter", filename);
            if (yield* fs.exists(current).pipe(Effect.orElseSucceed(() => false))) return current;
          } else {
            const grammar = path.resolve(nmBase, "tree-sitter-wasms", "out", filename);
            if (yield* fs.exists(grammar).pipe(Effect.orElseSucceed(() => false))) return grammar;
          }
        }

        return yield* new ParserError({ reason: "wasm_missing", detail: filename });
      });

      const state: {
        parser: TSParser | undefined;
        languages: HashMap.HashMap<string, Language>;
      } = { parser: undefined, languages: HashMap.empty() };
      yield* Effect.addFinalizer(() => Effect.sync(() => state.parser?.delete()));

      const ensureInit = yield* Effect.cached(
        Effect.gen(function* () {
          if (state.parser) return state.parser;
          const initPath = yield* resolveWasmPath("tree-sitter.wasm");
          const parser = yield* Effect.tryPromise({
            try: async () => {
              await TSParser.init({ locateFile: () => initPath });
              return new TSParser();
            },
            catch: (error) =>
              new ParserError({
                reason: "init_failed",
                detail: error instanceof Error ? error.message : String(error),
              }),
          });
          state.parser = parser;
          return parser;
        }),
      );

      const loadLanguage = Effect.fn("Parser.loadLanguage")(function* (grammar: string) {
        const cached = Option.getOrUndefined(HashMap.get(state.languages, grammar));
        if (cached) return cached;

        const file = Option.getOrUndefined(HashMap.get(GRAMMAR_FILES, grammar));
        if (!file) return yield* new ParserError({ reason: "unknown_grammar", grammar });

        const wasmPath = yield* resolveWasmPath(file);
        const lang = yield* Effect.tryPromise({
          try: () => Language.load(wasmPath),
          catch: (error) =>
            new ParserError({
              reason: "load_failed",
              grammar,
              detail: error instanceof Error ? error.message : String(error),
            }),
        });
        state.languages = HashMap.set(state.languages, grammar, lang);
        return lang;
      });

      return Parser.of({
        parse: Effect.fn("Parser.parse")(function* ({
          source,
          grammar,
        }: {
          readonly source: string;
          readonly grammar: string;
        }) {
          const parser = yield* ensureInit;
          const lang = yield* loadLanguage(grammar);
          parser.setLanguage(lang);
          const tree = parser.parse(source);
          if (!tree) return yield* new ParserError({ reason: "parse_failed", grammar });
          return tree;
        }),

        language: (grammar) => ensureInit.pipe(Effect.andThen(loadLanguage(grammar))),
      });
    }),
  );
}
