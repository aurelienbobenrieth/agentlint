import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { Parser } from "./parser.js";

const fixturesDir = resolve(import.meta.dirname, "../../__fixtures__");

const ParserLayer = Parser.layer.pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(Env.layer));

function runWithParser<A, E>(effect: Effect.Effect<A, E, Parser>) {
  return Effect.runPromise(effect.pipe(Effect.provide(ParserLayer)));
}

describe("Parser", () => {
  it("parses TypeScript files", async () => {
    const source = readFileSync(resolve(fixturesDir, "sample.ts"), "utf-8");

    await runWithParser(
      Effect.gen(function* () {
        const parser = yield* Parser;
        const tree = yield* parser.parse(source, "typescript");

        expect(tree.rootNode.type).toBe("program");
        expect(tree.rootNode.childCount).toBeGreaterThan(0);

        const funcs = tree.rootNode.descendantsOfType("function_declaration");
        expect(funcs.length).toBeGreaterThanOrEqual(2);
      }),
    );
  });

  it("parses TSX files", async () => {
    const source = readFileSync(resolve(fixturesDir, "sample.tsx"), "utf-8");

    await runWithParser(
      Effect.gen(function* () {
        const parser = yield* Parser;
        const tree = yield* parser.parse(source, "tsx");

        expect(tree.rootNode.type).toBe("program");

        const jsxElements = tree.rootNode.descendantsOfType("jsx_element");
        expect(jsxElements.length).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it("fails for unknown grammar", async () => {
    await expect(
      runWithParser(
        Effect.gen(function* () {
          const parser = yield* Parser;
          yield* parser.parse("x = 1", "python");
        }),
      ),
    ).rejects.toThrow("Unknown grammar");
  });
});
