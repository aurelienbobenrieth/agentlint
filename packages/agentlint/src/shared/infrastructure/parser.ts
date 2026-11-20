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
import { GRAMMAR_SOURCES, packagedGrammarFile } from "./grammars.js";
import { Language, Parser as TSParser, type Tree } from "web-tree-sitter";

/**
 * A `.wasm` asset: the file the build packages it as, and where an unbuilt checkout finds it under `node_modules`.
 */
interface WasmAsset {
  readonly file: string;
  readonly source: string;
}

const CORE_WASM: WasmAsset = { file: "tree-sitter.wasm", source: "web-tree-sitter/tree-sitter.wasm" };

/**
 * The grammars that read JavaScript escapes.
 */
const ECMASCRIPT_GRAMMARS: ReadonlySet<string> = new Set([
  "typescript",
  "typescript-0.23",
  "tsx",
  "tsx-0.20",
  "javascript",
]);

/**
 * Each escape in turn, so `\\u` stays an escaped backslash; the capture is a `\u` or `\x` that starts no escape.
 */
const ESCAPE = /\\(?:u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})|x[0-9a-fA-F]{2}|([ux])|[\s\S])/g;

/**
 * The source with each `\u` or `\x` that starts no escape read as `\_`, at the same length.
 *
 * A tagged template may hold one (`` String.raw`C:\users` ``), but every bundled grammar rejects it. Anywhere else a
 * backslash is opaque (comments, regexes, JSX text) or the escape was already an error, so a file that parses unmasked
 * keeps its tree.
 */
const maskInvalidEscapes = (source: string): string =>
  source.replace(ESCAPE, (escape, invalid: string | undefined) => (invalid === undefined ? escape : "\\_"));

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
const errorDetail = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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

      const resolveWasmPath = Effect.fn("Parser.resolveWasmPath")(function* ({ file, source }: WasmAsset) {
        const thisDir = path.resolve(import.meta.dirname);
        const distPath = resolvePackagedWasmPath({ path, dir: thisDir, filename: file });
        if (yield* fs.exists(distPath).pipe(Effect.orElseSucceed(() => false))) return distPath;

        const dependencyRoots = [
          path.resolve(env.cwd, "node_modules"),
          path.resolve(thisDir, "..", "..", "..", "node_modules"),
        ];
        for (const nmBase of dependencyRoots) {
          const current = path.resolve(nmBase, source);
          if (yield* fs.exists(current).pipe(Effect.orElseSucceed(() => false))) return current;
        }

        return yield* new ParserError({ reason: "wasm_missing", detail: file });
      });

      const state: {
        parser: TSParser | undefined;
        languages: HashMap.HashMap<string, Language>;
      } = { parser: undefined, languages: HashMap.empty() };
      yield* Effect.addFinalizer(() => Effect.sync(() => state.parser?.delete()));

      const ensureInit = yield* Effect.cached(
        Effect.gen(function* () {
          if (state.parser) return state.parser;
          const initPath = yield* resolveWasmPath(CORE_WASM);
          const parser = yield* Effect.tryPromise({
            try: async () => {
              await TSParser.init({ locateFile: () => initPath });
              return new TSParser();
            },
            catch: (error) =>
              new ParserError({
                reason: "init_failed",
                detail: errorDetail(error),
              }),
          });
          state.parser = parser;
          return parser;
        }),
      );

      const loadLanguage = Effect.fn("Parser.loadLanguage")(function* (grammar: string) {
        const cached = Option.getOrUndefined(HashMap.get(state.languages, grammar));
        if (cached) return cached;

        const source = Object.hasOwn(GRAMMAR_SOURCES, grammar) ? GRAMMAR_SOURCES[grammar] : undefined;
        if (!source) return yield* new ParserError({ reason: "unknown_grammar", grammar });

        const wasmPath = yield* resolveWasmPath({ file: packagedGrammarFile(grammar), source });
        const lang = yield* Effect.tryPromise({
          try: () => Language.load(wasmPath),
          catch: (error) =>
            new ParserError({
              reason: "load_failed",
              grammar,
              detail: errorDetail(error),
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
          // Both calls throw: `setLanguage` on a grammar ABI the runtime does not support, `parse` on a WASM trap.
          yield* Effect.try({
            try: () => parser.setLanguage(lang),
            catch: (cause) => new ParserError({ reason: "load_failed", grammar, detail: errorDetail(cause) }),
          });
          let input = ECMASCRIPT_GRAMMARS.has(grammar) ? maskInvalidEscapes(source) : source;
          const tree = yield* Effect.try({
            try: () => {
              // Node text and query predicates read through this callback after parsing: point it back at the file.
              const parsed = parser.parse((index) => input.slice(index));
              input = source;
              return parsed;
            },
            catch: (cause) => new ParserError({ reason: "parse_failed", grammar, detail: errorDetail(cause) }),
          });
          if (!tree) return yield* new ParserError({ reason: "parse_failed", grammar });
          return tree;
        }),

        language: (grammar) => ensureInit.pipe(Effect.andThen(loadLanguage(grammar))),
      });
    }),
  );
}
