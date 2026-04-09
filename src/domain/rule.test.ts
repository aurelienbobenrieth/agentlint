import { describe, expect, it } from "vitest";
import { defineConfig } from "./config.js";
import { defineRule } from "./rule.js";

describe("defineRule", () => {
  it("returns the rule unchanged", () => {
    const rule = defineRule({
      meta: {
        name: "test-rule",
        description: "A test rule",
        languages: ["ts", "tsx"],
        instruction: "Evaluate this thing.",
      },
      createOnce(_context) {
        return {
          comment(_node) {},
        };
      },
    });

    expect(rule.meta.name).toBe("test-rule");
    expect(rule.meta.languages).toEqual(["ts", "tsx"]);
    expect(typeof rule.createOnce).toBe("function");
  });

  it("preserves optional include/ignore on meta", () => {
    const rule = defineRule({
      meta: {
        name: "scoped-rule",
        description: "Scoped",
        languages: ["ts"],
        instruction: "Check it.",
        include: ["src/actions/**"],
        ignore: ["**/*.test.ts"],
      },
      createOnce() {
        return {};
      },
    });

    expect(rule.meta.include).toEqual(["src/actions/**"]);
    expect(rule.meta.ignore).toEqual(["**/*.test.ts"]);
  });
});

describe("defineConfig", () => {
  it("returns the config unchanged", () => {
    const rule = defineRule({
      meta: {
        name: "r",
        description: "d",
        languages: ["ts"],
        instruction: "i",
      },
      createOnce() {
        return {};
      },
    });

    const config = defineConfig({
      include: ["src/**/*.ts"],
      ignore: ["dist/**"],
      rules: { r: rule },
    });

    expect(config.rules["r"]).toBe(rule);
    expect(config.include).toEqual(["src/**/*.ts"]);
  });
});
