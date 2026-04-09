import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { defineConfig, defineRule } from "../../index.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { listHandler } from "./handler.js";
import { ListCommand } from "./request.js";

const testRuleA = defineRule({
  meta: {
    name: "no-console",
    description: "Disallow console.log statements",
    languages: ["ts", "tsx"],
    instruction: "Flag console.log calls.",
  },
  createOnce() {
    return {};
  },
});

const testRuleB = defineRule({
  meta: {
    name: "no-any",
    description: "Disallow the any type",
    languages: ["ts"],
    instruction: "Flag any type annotations.",
    include: ["src/**/*.ts"],
    ignore: ["**/*.test.ts"],
  },
  createOnce() {
    return {};
  },
});

const testConfig = defineConfig({
  rules: {
    "no-console": testRuleA,
    "no-any": testRuleB,
  },
});

const TestConfigLoader = Layer.succeed(
  ConfigLoader,
  ConfigLoader.of({
    load: () => Effect.succeed(testConfig),
  }),
);

const emptyConfig = defineConfig({ rules: {} });

const EmptyConfigLoader = Layer.succeed(
  ConfigLoader,
  ConfigLoader.of({
    load: () => Effect.succeed(emptyConfig),
  }),
);

describe("listHandler", () => {
  it("lists rules with correct metadata", async () => {
    const result = await Effect.runPromise(listHandler(new ListCommand()).pipe(Effect.provide(TestConfigLoader)));

    expect(result._tag).toBe("ListResult");
    expect(result.rules).toHaveLength(2);

    const noConsole = result.rules.find((r) => r.name === "no-console");
    expect(noConsole).toBeDefined();
    expect(noConsole!.description).toBe("Disallow console.log statements");
    expect(noConsole!.languages).toEqual(["ts", "tsx"]);
    expect(noConsole!.include).toBeUndefined();
    expect(noConsole!.ignore).toBeUndefined();

    const noAny = result.rules.find((r) => r.name === "no-any");
    expect(noAny).toBeDefined();
    expect(noAny!.description).toBe("Disallow the any type");
    expect(noAny!.languages).toEqual(["ts"]);
    expect(noAny!.include).toEqual(["src/**/*.ts"]);
    expect(noAny!.ignore).toEqual(["**/*.test.ts"]);
  });

  it("returns empty array when no rules are configured", async () => {
    const result = await Effect.runPromise(listHandler(new ListCommand()).pipe(Effect.provide(EmptyConfigLoader)));

    expect(result._tag).toBe("ListResult");
    expect(result.rules).toHaveLength(0);
  });
});
