import { describe, expect, it } from "vitest";
import { defineConfig, normalizeConfig } from "./config.js";
import { compactStandard, normalizeGuidance } from "./guidance.js";
import { defineRule } from "./rule.js";

const rule = defineRule({
  id: "comments/no-noise",
  description: "Flags comments that need noise review.",
  guidance: {
    standard: "Comments should add durable context beyond the code.",
    checks: ["Comments should not restate identifiers."],
  },
  createOnce() {
    return {
      comment() {},
    };
  },
});

describe("defineRule", () => {
  it("uses id, description, guidance, and createOnce", () => {
    expect(rule.id).toBe("comments/no-noise");
    expect(rule.description).toContain("comments");
    expect(normalizeGuidance(rule.guidance).checks).toEqual(["Comments should not restate identifiers."]);
  });

  it("supports string guidance", () => {
    const standard = compactStandard("One standard.\nMore detail.");
    expect(standard).toBe("One standard.");
  });
});

describe("defineConfig", () => {
  it("normalizes files, ignores, policy, and overrides", () => {
    const config = normalizeConfig(
      defineConfig({
        rules: { "comments/no-noise": rule },
        policy: { "comments/no-noise": { persistence: "durable" } },
        files: ["src/**/*.ts"],
        ignores: ["**/*.test.ts"],
        overrides: [{ files: ["docs/**/*.ts"], rules: { "comments/no-noise": "off" } }],
      }),
    );

    expect(config.policy["comments/no-noise"]?.persistence).toBe("durable");
    expect(config.files).toEqual(["src/**/*.ts"]);
    expect(config.ignores).toEqual(["**/*.test.ts"]);
    expect(config.overrides).toHaveLength(1);
  });

  it("composes presets before local config", () => {
    const preset = defineConfig({
      rules: { "comments/no-noise": rule },
      files: ["packages/**/*.{ts,tsx}"],
    });
    const config = normalizeConfig(
      defineConfig({
        extends: [preset],
        files: ["src/**/*.{ts,tsx}"],
      }),
    );

    expect(Object.keys(config.rules)).toEqual(["comments/no-noise"]);
    expect(config.files).toEqual(["src/**/*.{ts,tsx}"]);
  });

  it("throws on unknown policy ids", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          rules: { "comments/no-noise": rule },
          policy: { "missing/rule": { persistence: "ephemeral" } },
        }),
      ),
    ).toThrow("Unknown rule id in policy");
  });
});
