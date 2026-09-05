/**
 * Tree-sitter WASM parser.
 *
 * WASM init is lazy — the first `parse` call triggers initialization.
 * Grammars are cached after first load.
 *
 * @module
 * @since 0.1.0
 */

import { Context, Effect, FileSystem, HashMap, Layer, Option, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import { Language, Parser as TSParser, type Tree } from "web-tree-sitter";

/**
 * Raised when parsing fails — e.g. missing grammar, corrupt WASM, or
 * tree-sitter returning a null tree.
 *
 * @since 0.1.0
 * @category errors
 */
export class ParserError extends Schema.TaggedError<ParserError>()("agentlint/ParserError", {
  reason: Schema.Literals(["wasm_missing", "unknown_grammar", "init_failed", "load_failed", "parse_failed"]),
  grammar: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    switch (this.reason) {
      case "wasm_missing":
        return `WASM file not found: ${this.detail}`;
      case "unknown_grammar":
        return `Unknown grammar: ${this.grammar}`;
      case "init_failed":
        return `Parser failed to initialize${this.detail ? `: ${this.detail}` : ""}`;
      case "load_failed":
        return `Failed to load grammar ${this.grammar}: ${this.detail}`;
      case "parse_failed":
        return `Parse failed${this.grammar ? ` (${this.grammar})` : ""}: ${this.detail ?? "parser returned null tree"}`;
    }
  }
}

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
  ["json", "tree-sitter-json.wasm"],
);

export function resolvePackagedWasmPath(path: Pick<Path.Path, "resolve">, dir: string, filename: string): string {
  return path.resolve(dir, "wasm", filename);
}

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
export class Parser extends Context.Service<
  Parser,
  {
    parse(source: string, grammar: string): Effect.Effect<Tree, ParserError>;
    /** The loaded tree-sitter language used to construct queries. */
    language(grammar: string): Effect.Effect<Language, ParserError>;
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
          const thisDir = path.resolve(import.meta.dirname ?? ".");
          const distPath = resolvePackagedWasmPath(path, thisDir, filename);
          if (yield* fs.exists(distPath).pipe(Effect.orElseSucceed(() => false))) return distPath;

          const dependencyRoots = [
            path.resolve(env.cwd, "node_modules"),
            path.resolve(thisDir, "..", "..", "..", "node_modules"),
          ];
          for (const nmBase of dependencyRoots) {
            if (filename === "tree-sitter.wasm") {
              const current = path.resolve(nmBase, "web-tree-sitter", filename);
              if (yield* fs.exists(current).pipe(Effect.orElseSucceed(() => false))) return current;
              const legacy = path.resolve(nmBase, "web-tree-sitter", "web-tree-sitter.wasm");
              if (yield* fs.exists(legacy).pipe(Effect.orElseSucceed(() => false))) return legacy;
            } else {
              const grammar = path.resolve(nmBase, "tree-sitter-wasms", "out", filename);
              if (yield* fs.exists(grammar).pipe(Effect.orElseSucceed(() => false))) return grammar;
            }
          }

          return yield* new ParserError({ reason: "wasm_missing", detail: filename });
        });

      let parserInstance: TSParser | undefined;
      yield* Effect.addFinalizer(() => Effect.sync(() => parserInstance?.delete()));
      let languageCache: HashMap.HashMap<string, Language> = HashMap.empty();

      const ensureInit = yield* Effect.cached(
        Effect.gen(function* () {
          if (parserInstance) return parserInstance;
          const initPath = yield* resolveWasmPath("tree-sitter.wasm");
          yield* Effect.tryPromise({
            try: async () => {
              await TSParser.init({ locateFile: () => initPath });
              parserInstance = new TSParser();
            },
            catch: (error) =>
              new ParserError({
                reason: "init_failed",
                detail: error instanceof Error ? error.message : String(error),
              }),
          });
          const parser = parserInstance;
          if (!parser) return yield* new ParserError({ reason: "init_failed" });
          return parser;
        }),
      );

      const loadLanguage = (grammar: string): Effect.Effect<Language, ParserError> =>
        Effect.gen(function* () {
          const cached = Option.getOrUndefined(HashMap.get(languageCache, grammar));
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
          languageCache = HashMap.set(languageCache, grammar, lang);
          return lang;
        });

      return Parser.of({
        parse: (source, grammar) =>
          Effect.gen(function* () {
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
