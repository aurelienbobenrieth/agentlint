import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { defineConfig, normalizeConfig } from "./config.js";
import { defineRule, RuleDefinitionError } from "./rule/model.js";
import type { CanonicalValue } from "./fingerprint.js";

const valid = {
  lifecycle: "state",
  standard: { id: "review", revision: 1, title: "Review", guidance: "Verify authorization." },
  detector: { id: "danger", version: 1, match: { pattern: "danger($ARG)", message: "Review this call." } },
  binding: { id: "review", authority: "agent" },
} as const;
const change = {
  lifecycle: "change",
  standard: valid.standard,
  detector: { id: "sql/drop", version: 1, detect() {} },
  binding: { id: "migrations", authority: "human" },
} as const;

/**
 * A config written in JavaScript reaches the engine without the compiler's help.
 */
interface RuntimeRuleDefinition {
  readonly lifecycle?: string;
  readonly standard?: object | undefined;
  readonly detector?: object | undefined;
  readonly binding?: object | undefined;
}

const definitionError = (rule: RuntimeRuleDefinition): RuleDefinitionError | undefined => {
  try {
    Reflect.apply(defineRule, undefined, [rule]);
  } catch (error) {
    return Schema.decodeUnknownSync(RuleDefinitionError)(error);
  }
  return undefined;
};

describe("defineRule rejects what the type system cannot see", () => {
  it("accepts the baseline rules used below", () => {
    expect(definitionError(valid)).toBeUndefined();
    expect(definitionError(change)).toBeUndefined();
  });

  it.each([
    ["an unknown lifecycle", { ...valid, lifecycle: "typo" }],
    ["an unknown authority", { ...valid, binding: { ...valid.binding, authority: "admin" } }],
    ["a missing binding", { ...valid, binding: undefined }],
    ["an unknown scan mode", { ...valid, detector: { ...valid.detector, scan: "folder" } }],
    ["a textual version", { ...valid, detector: { ...valid.detector, version: "1" } }],
  ])("reports %s as an invalid shape", (_label, rule) => {
    expect(definitionError(rule)).toBeInstanceOf(RuleDefinitionError);
    expect(definitionError(rule)).toMatchObject({ reason: "invalid_shape" });
  });

  it.each([
    ["binding id", { ...valid, binding: { ...valid.binding, id: "  " } }],
    ["detector id", { ...valid, detector: { ...valid.detector, id: " " } }],
    ["scope pattern", { ...valid, binding: { ...valid.binding, include: ["src/**", " "] } }],
    ["scope pattern", { ...valid, binding: { ...valid.binding, exclude: ["	"] } }],
  ])("rejects a blank %s", (field, rule) => {
    expect(definitionError(rule)).toMatchObject({ reason: "empty_field", field });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "requires a positive integer detector version, not %s",
    (version) => {
      expect(definitionError({ ...valid, detector: { ...valid.detector, version } })).toMatchObject({
        reason: "invalid_detector_version",
        ruleId: "review",
      });
    },
  );

  it("requires an executable implementation for each lifecycle", () => {
    expect(definitionError({ ...change, detector: { id: "sql/drop", version: 1 } })).toMatchObject({
      reason: "missing_change_detect",
    });
    expect(definitionError({ ...change, detector: { id: "sql/drop", version: 1, detect: "DROP" } })).toMatchObject({
      reason: "missing_change_detect",
    });
    expect(definitionError({ ...valid, detector: { id: "danger", version: 1, createOnce: "visitor" } })).toMatchObject({
      reason: "missing_state_implementation",
    });
    expect(definitionError({ ...valid, detector: { id: "danger", version: 1, match: [] } })).toMatchObject({
      reason: "missing_state_implementation",
    });
  });

  it("requires exactly one trigger in every match of a list", () => {
    const matches = [{ pattern: "danger($A)", message: "Review." }, { message: "No trigger." }];
    expect(definitionError({ ...valid, detector: { id: "danger", version: 1, match: matches } })).toMatchObject({
      reason: "ambiguous_match",
    });
  });

  it("keeps supporting files exact and limited to state bindings", () => {
    const withDependencies = ({
      dependencies,
      base = valid,
    }: {
      readonly dependencies: ReadonlyArray<string>;
      readonly base?: typeof valid | typeof change;
    }) => definitionError({ ...base, binding: { ...base.binding, dependencies } });

    expect(withDependencies({ dependencies: ["src/policy.ts"] })).toBeUndefined();
    const inexact = ["./src/policy.ts", "src\\policy.ts", "src/*.ts", "src/{a,b}.ts"];
    expect(inexact.map((dependency) => withDependencies({ dependencies: [dependency] }))).toEqual(
      inexact.map(() => expect.objectContaining({ reason: "invalid_shape" })),
    );
    expect(() =>
      Reflect.apply(defineRule, undefined, [{ ...valid, binding: { ...valid.binding, dependencies: ["../x.ts"] } }]),
    ).toThrow("escapes");
    expect(withDependencies({ dependencies: ["src/policy.ts"], base: change })).toMatchObject({
      reason: "invalid_shape",
      field: expect.stringContaining("state bindings"),
    });
  });

  it("rejects options that cannot be part of a stable binding digest", () => {
    const withOptions =
      (
        options:
          | CanonicalValue
          | Date
          | RegExp
          | (() => boolean)
          | { readonly callback: () => boolean }
          | { readonly since: Date }
          | { readonly matcher: RegExp },
      ) =>
      () =>
        Reflect.apply(defineRule, undefined, [{ ...valid, binding: { ...valid.binding, options } }]);
    expect(withOptions({ limit: 5, tags: ["a"], nested: { on: true } })).not.toThrow();
    expect(withOptions({ since: new Date(0) })).toThrow("plain objects");
    expect(withOptions({ matcher: /x/ })).toThrow("plain objects");
    expect(withOptions({ limit: Number.NaN })).toThrow("finite");
    expect(withOptions({ callback: () => true })).toThrow("not canonical JSON data");
  });

  it("names the rule in every message", () => {
    const error = definitionError({ ...valid, detector: { ...valid.detector, version: 0 } });
    expect(error).toBeInstanceOf(RuleDefinitionError);
    expect(error?.message).toBe("Rule review: detector version must be a positive integer");
  });
});

describe("config layers", () => {
  const other = defineRule({ ...valid, binding: { id: "other", authority: "agent" } });

  it("orders inherited rules before local ones and merges ignores once", () => {
    const shared = defineConfig({ rules: [valid], ignores: ["dist/**"] });
    const config = normalizeConfig({ extends: [shared], rules: [other], ignores: ["dist/**", "vendor/**"] });
    expect(config.rules.map((rule) => rule.binding.id)).toEqual(["review", "other"]);
    expect([...config.rulesById.keys()]).toEqual(["review", "other"]);
    expect(config.ignores).toEqual(["dist/**", "vendor/**"]);
  });

  it("lets the most local base win and omits it when no layer sets one", () => {
    const shared = defineConfig({ base: "develop" });
    expect(normalizeConfig({ extends: [shared] }).base).toBe("develop");
    expect(normalizeConfig({ extends: [shared], base: "main" }).base).toBe("main");
    expect(normalizeConfig({ rules: [valid] })).not.toHaveProperty("base");
  });

  it("allows one layer to be shared by two parents", () => {
    const leaf = defineConfig({ ignores: ["dist/**"] });
    const config = normalizeConfig({ extends: [{ extends: [leaf] }, { extends: [leaf] }] });
    expect(config.ignores).toEqual(["dist/**"]);
  });

  it("validates rules that only an inherited layer contains", () => {
    const broken = { rules: [{ ...valid, detector: { ...valid.detector, version: 0 } }] };
    expect(() => normalizeConfig({ extends: [broken] })).toThrow("positive integer");
    expect(() => normalizeConfig({ extends: [{ rules: [valid] }], rules: [valid] })).toThrow(
      "Duplicate rule binding id: review",
    );
  });

  it("rejects a config whose fields have the wrong type", () => {
    expect(() => Reflect.apply(defineConfig, undefined, [{ ignores: "dist/**" }])).toThrow("ignores");
    expect(() => Reflect.apply(defineConfig, undefined, [{ rules: valid }])).toThrow("rules");
  });
});
