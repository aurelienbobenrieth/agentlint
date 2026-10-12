import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  bindingDigest,
  canonicalDigest,
  canonicalStringify,
  Fingerprint,
  fingerprintChange,
  fingerprintEvidence,
  fingerprintState,
  isSupportedFingerprint,
  normalizeRepositoryPath,
} from "./fingerprint.js";

const fingerprintOf = (evidence: unknown) => () =>
  fingerprintChange({
    before: null,
    after: evidence as never,
    beforePath: "a.sql",
    afterPath: "a.sql",
    operation: "add",
    occurrence: "k",
  });

describe("canonical fingerprints", () => {
  it("ignores object key order and preserves distinct Unicode", () => {
    expect(canonicalDigest({ b: 2, a: "e\u0301" })).not.toBe(canonicalDigest({ a: "é", b: 2 }));
    expect(canonicalStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("keeps the exact encoding every stored fingerprint was digested from", () => {
    // Written by hand from the JSON grammar: persisted acceptances depend on these bytes.
    expect(
      canonicalStringify({
        z: [-0, 1e21, 0.1, -3, true, false, null],
        é: 'tab\there "quoted" back\\slash \u0001   \ud800 😀',
        a: { y: [], x: {} },
      }),
    ).toBe(
      '{"a":{"x":{},"y":[]},"z":[0,1e+21,0.1,-3,true,false,null],"é":"tab\\there \\"quoted\\" back\\\\slash \\u0001   \\ud800 😀"}',
    );
    // sha256 of the literal text `["",0,"program"]`.
    expect(canonicalDigest(["", 0, "program"])).toBe(
      "4c8d1d693b342a674b4601a64acb9e9a1f704ce6f7911e4ce26ec4b1b8ed9cd1",
    );
  });

  it("rejects values outside canonical JSON", () => {
    expect(() => canonicalStringify({ value: Number.NaN })).toThrow("numbers must be finite");
    expect(() => Reflect.apply(canonicalStringify, undefined, [{ value: undefined }])).toThrow(
      "not canonical JSON data",
    );
  });

  it("locates an evidence failure inside the evidence and rethrows any other failure", () => {
    const located = fingerprintEvidence({ evidence: { n: Number.NaN }, fingerprint: fingerprintOf({ n: Number.NaN }) });
    expect(Result.isFailure(located) && located.failure.detail).toBe("numbers must be finite: NaN at $.n");
    const valid = fingerprintEvidence({ evidence: { n: 1 }, fingerprint: () => "computed digest" });
    expect(Result.isSuccess(valid) && valid.success).toBe("computed digest");
    expect(() => fingerprintEvidence({ evidence: { n: 1 }, fingerprint: fingerprintOf({ n: Number.NaN }) })).toThrow(
      "numbers must be finite: NaN at $.after.n",
    );
  });

  it("names what it rejected and where", () => {
    expect(() =>
      Reflect.apply(canonicalStringify, undefined, [
        { "odd key": [0, { v: undefined }], ok: [Number.POSITIVE_INFINITY] },
      ]),
    ).toThrow('the value is not canonical JSON data: undefined at $["odd key"][1].v');
    expect(() => canonicalStringify({ ok: [Number.POSITIVE_INFINITY] })).toThrow(
      "numbers must be finite: Infinity at $.ok[0]",
    );
    expect(() => Reflect.apply(canonicalStringify, undefined, [new Map()])).toThrow(
      "only plain objects can be canonicalized: Map at $",
    );
  });

  it("locates cycles without rejecting shared objects or null-prototype JSON", () => {
    const cycle: unknown[] = [0];
    cycle.push(cycle);
    expect(() => Reflect.apply(canonicalStringify, undefined, [{ nested: cycle }])).toThrow(
      "canonical JSON data cannot contain cycles: a cycle at $.nested[1]",
    );
    const shared = Object.assign(Object.create(null), { n: 1 });
    expect(canonicalStringify({ b: shared, a: shared })).toBe('{"a":{"n":1},"b":{"n":1}}');
  });

  it("normalizes equivalent repository paths", () => {
    expect(normalizeRepositoryPath("./src\\domain/../index.ts")).toBe("src/index.ts");
    expect(() => normalizeRepositoryPath("../outside.ts")).toThrow("escapes the repository");
    expect(() => normalizeRepositoryPath("C:/repo/file.ts")).toThrow("repository-relative");
  });

  it("keeps state fingerprints through formatting and line movement", () => {
    const first = fingerprintState({
      path: "src/query.ts",
      structure: { call: "findMany", arguments: [{ limit: 10 }] },
      occurrence: "function:listUsers/call:0",
    });
    const formattedAndMoved = fingerprintState({
      path: "./src\\query.ts",
      structure: { arguments: [{ limit: 10 }], call: "findMany" },
      occurrence: "function:listUsers/call:0",
    });

    expect(first).toEqual(formattedAndMoved);
  });

  it("emits and supports only the current state scheme version", () => {
    const current = fingerprintState({ path: "src/query.ts", structure: [], occurrence: "call:0" });
    expect(current).toMatchObject({ scheme: "source-structure", version: 4 });
    expect(isSupportedFingerprint(current)).toBe(true);
    for (const version of [2, 3, 5])
      expect(isSupportedFingerprint(new Fingerprint({ scheme: current.scheme, version, digest: current.digest }))).toBe(
        false,
      );
  });

  it("invalidates state fingerprints for paths, captures, and duplicate occurrences", () => {
    const base = {
      path: "src/query.ts",
      structure: { call: "findMany" },
      captures: { table: "users" },
      occurrence: "function:listUsers/call:0",
    } as const;
    const fingerprint = fingerprintState(base);

    expect(fingerprintState({ ...base, path: "src/moved.ts" }).digest).not.toBe(fingerprint.digest);
    expect(fingerprintState({ ...base, captures: { table: "accounts" } }).digest).not.toBe(fingerprint.digest);
    expect(fingerprintState({ ...base, occurrence: "function:listUsers/call:1" }).digest).not.toBe(fingerprint.digest);
  });

  it("identifies equal change evidence independently of a Git rebase", () => {
    const evidence = {
      before: { columns: ["id", "name"] },
      after: { columns: ["id"] },
      beforePath: "migrations/users.sql",
      afterPath: "migrations/users.sql",
      operation: "modify" as const,
      occurrence: "table:users/column:name",
    };
    expect(fingerprintChange(evidence)).toEqual(fingerprintChange({ ...evidence }));
    expect(fingerprintChange({ ...evidence, operation: "rename" }).digest).not.toBe(fingerprintChange(evidence).digest);
  });

  it("normalizes binding object and routing-set order", () => {
    const left = bindingDigest({
      include: ["src/**/*.ts", "packages/**/*.ts"],
      options: { client: "prisma", operations: ["read", "write"] },
    });
    const right = bindingDigest({
      options: { operations: ["read", "write"], client: "prisma" },
      include: ["packages/**/*.ts", "src/**/*.ts"],
    });
    expect(left).toBe(right);
    expect(bindingDigest({ options: { operations: ["write", "read"], client: "prisma" } })).not.toBe(
      bindingDigest({ options: { operations: ["read", "write"], client: "prisma" } }),
    );
  });
});
