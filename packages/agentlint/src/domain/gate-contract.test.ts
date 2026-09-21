import { describe, expect, it } from "vitest";
import {
  AcceptanceRecord,
  acceptanceSatisfies,
  acceptanceSnapshot,
  findLineage,
  invalidationReasons,
  lookupAcceptance,
} from "./acceptance.js";
import { FindingRecord } from "./finding.js";
import {
  bindingDigest,
  canonicalDigest,
  canonicalStringify,
  Fingerprint,
  FindingSource,
  fingerprintChange,
  fingerprintState,
  normalizeRepositoryPath,
} from "./fingerprint.js";

const sourceFields = {
  standardId: "data/bounded-query",
  standardRevision: 1,
  detectorId: "prisma/find-many",
  detectorVersion: 1,
  bindingId: "app-queries",
  bindingDigest: "binding-a",
};
const fingerprintFields = { scheme: "source-structure", version: 3, digest: "evidence-a" };

function finding(overrides: Partial<ConstructorParameters<typeof FindingRecord>[0]> = {}) {
  return new FindingRecord({
    selector: undefined,
    ruleId: "bounded-query",
    lifecycle: "state",
    authority: "agent",
    source: new FindingSource(sourceFields),
    fingerprint: new Fingerprint(fingerprintFields),
    lineageKey: "list-users-query",
    file: "src/query.ts",
    line: 4,
    column: 3,
    endLine: 4,
    endColumn: 21,
    message: "Review this unbounded query.",
    sourceSnippet: "db.user.findMany()",
    ...overrides,
  });
}

function acceptance(overrides: Partial<ConstructorParameters<typeof AcceptanceRecord>[0]> = {}) {
  return new AcceptanceRecord({
    schemaVersion: 1,
    source: new FindingSource(sourceFields),
    fingerprint: new Fingerprint(fingerprintFields),
    lineageKey: "list-users-query",
    reason: "The caller applies a fixed upstream bound.",
    authority: "agent",
    actor: "agent:test",
    acceptedAt: "2026-08-10T12:00:00.000Z",
    ...overrides,
  });
}

describe("an acceptance opens a gate only for the identical identity", () => {
  it.each([
    ["standardId", "data/other"],
    ["standardRevision", 2],
    ["detectorId", "prisma/other"],
    ["detectorVersion", 2],
    ["bindingId", "other-queries"],
    ["bindingDigest", "binding-b"],
  ] as const)("stays closed when the finding's %s differs", (field, value) => {
    const moved = finding({ source: new FindingSource({ ...sourceFields, [field]: value }) });
    expect(acceptanceSatisfies({ acceptance: acceptance(), finding: moved })).toBe(false);
    expect(lookupAcceptance({ acceptances: acceptanceSnapshot([acceptance()]), finding: moved })).toBeUndefined();
  });

  it.each([
    ["digest", { digest: "evidence-b" }],
    ["scheme", { scheme: "git-change" }],
  ] as const)("stays closed when the evidence %s differs", (_label, change) => {
    const moved = finding({ fingerprint: new Fingerprint({ ...fingerprintFields, ...change }) });
    expect(acceptanceSatisfies({ acceptance: acceptance(), finding: moved })).toBe(false);
  });

  it.each([
    ["an unknown scheme", { scheme: "source-text" }],
    ["a retired version", { version: 1 }],
    ["a future version", { version: 4 }],
  ] as const)("never trusts %s, even when both sides agree", (_label, change) => {
    const unsupported = new Fingerprint({ ...fingerprintFields, ...change });
    expect(
      acceptanceSatisfies({
        acceptance: acceptance({ fingerprint: unsupported }),
        finding: finding({ fingerprint: unsupported }),
      }),
    ).toBe(false);
  });

  it.each([
    ["agent", "agent", true],
    ["human", "agent", true],
    ["human", "human", true],
    ["agent", "human", false],
  ] as const)("%s authority on a %s binding: open=%s", (actual, required, open) => {
    expect(
      acceptanceSatisfies({ acceptance: acceptance({ authority: actual }), finding: finding({ authority: required }) }),
    ).toBe(open);
  });

  it("resolves the acceptance from an exact-identity snapshot", () => {
    const unrelated = acceptance({ fingerprint: new Fingerprint({ ...fingerprintFields, digest: "other" }) });
    expect(lookupAcceptance({ acceptances: acceptanceSnapshot([]), finding: finding() })).toBeUndefined();
    expect(lookupAcceptance({ acceptances: acceptanceSnapshot([unrelated]), finding: finding() })).toBeUndefined();
    expect(
      lookupAcceptance({ acceptances: acceptanceSnapshot([unrelated, acceptance()]), finding: finding() }),
    ).toEqual(acceptance());
  });
});

const reasonsFor = ({
  current,
  prior = acceptance(),
}: {
  readonly current: FindingRecord;
  readonly prior?: AcceptanceRecord;
}) => invalidationReasons({ prior, current });

describe("invalidation explanations", () => {
  it("reports nothing for a compatible decision", () => {
    expect(reasonsFor({ current: finding() })).toEqual([]);
  });

  it("names each compatibility field that moved", () => {
    const moved = finding({
      authority: "human",
      source: new FindingSource({
        ...sourceFields,
        standardRevision: 2,
        detectorVersion: 2,
        bindingDigest: "binding-b",
      }),
    });
    expect(reasonsFor({ current: moved })).toEqual([
      "The standard revision changed.",
      "The detector version changed.",
      "The binding scope, options, or declared dependencies changed.",
      "The binding now requires human authority.",
    ]);
  });

  it("distinguishes changed evidence by lifecycle and a changed scheme from a changed digest", () => {
    const newDigest = new Fingerprint({ ...fingerprintFields, digest: "evidence-b" });
    expect(reasonsFor({ current: finding({ fingerprint: newDigest }) })).toEqual([
      "The containing file structure, occurrence, or declared dependency evidence changed.",
    ]);
    expect(reasonsFor({ current: finding({ fingerprint: newDigest, lifecycle: "change" }) })).toEqual([
      "The detector-selected change evidence changed.",
    ]);
    const retired = acceptance({ fingerprint: new Fingerprint({ ...fingerprintFields, version: 1, digest: "old" }) });
    expect(reasonsFor({ current: finding(), prior: retired })).toEqual([
      "The evidence fingerprint scheme changed; a new review is required.",
    ]);
  });
});

describe("lineage is context and never a decision", () => {
  const edited = finding({ fingerprint: new Fingerprint({ ...fingerprintFields, digest: "evidence-b" }) });

  it("returns the most recent prior reason for the same rule lineage", () => {
    const older = acceptance({ reason: "Older.", acceptedAt: "2026-08-01T00:00:00.000Z" });
    const newer = acceptance({ reason: "Newer.", acceptedAt: "2026-08-09T00:00:00.000Z" });
    expect(findLineage({ records: [older, newer], finding: edited })?.reason).toBe("Newer.");
    expect(findLineage({ records: [newer, older], finding: edited })?.reason).toBe("Newer.");
    expect(lookupAcceptance({ acceptances: acceptanceSnapshot([older, newer]), finding: edited })).toBeUndefined();
  });

  it("excludes the record that currently satisfies the finding", () => {
    expect(findLineage({ records: [acceptance()], finding: finding() })).toBeUndefined();
  });

  it.each([
    ["another lineage key", { lineageKey: "another-query" }],
    ["another standard", { source: new FindingSource({ ...sourceFields, standardId: "data/other" }) }],
    ["another detector", { source: new FindingSource({ ...sourceFields, detectorId: "prisma/other" }) }],
    ["another binding", { source: new FindingSource({ ...sourceFields, bindingId: "other-queries" }) }],
  ] as const)("does not borrow a reason from %s", (_label, overrides) => {
    expect(findLineage({ records: [acceptance(overrides)], finding: edited })).toBeUndefined();
  });

  it("offers nothing when the finding declares no lineage", () => {
    const anonymous = finding({ lineageKey: undefined, fingerprint: edited.fingerprint });
    expect(findLineage({ records: [acceptance({ lineageKey: undefined })], finding: anonymous })).toBeUndefined();
  });
});

describe("canonical evidence encoding", () => {
  it("is independent of object key order and sensitive to array order", () => {
    expect(canonicalDigest({ a: 1, b: { c: [1, 2], d: null } })).toBe(
      canonicalDigest({ b: { d: null, c: [1, 2] }, a: 1 }),
    );
    expect(canonicalDigest({ list: [1, 2] })).not.toBe(canonicalDigest({ list: [2, 1] }));
  });

  it("separates values that loose encodings merge", () => {
    const digests = [canonicalDigest("1"), canonicalDigest(1), canonicalDigest(true), canonicalDigest(null)];
    expect(new Set(digests).size).toBe(4);
    expect(canonicalStringify(-0)).toBe(canonicalStringify(0));
    expect(canonicalStringify({ text: 'quote " and \\ slash' })).toBe('{"text":"quote \\" and \\\\ slash"}');
  });

  it("accepts a plain value that appears twice and objects without a prototype", () => {
    const shared = { limit: 5 };
    expect(canonicalStringify({ first: shared, second: shared })).toBe('{"first":{"limit":5},"second":{"limit":5}}');
    const withoutPrototype = Object.create(null);
    Reflect.set(withoutPrototype, "a", 1);
    expect(canonicalStringify(withoutPrototype)).toBe('{"a":1}');
  });

  it.each([
    ["NaN", Number.NaN, "finite"],
    ["Infinity", Number.POSITIVE_INFINITY, "finite"],
    ["undefined", undefined, "not canonical JSON data"],
    ["a function", () => 1, "not canonical JSON data"],
    ["a bigint", 1n, "not canonical JSON data"],
    ["a Date", new Date(0), "plain objects"],
    ["a Map", new Map(), "plain objects"],
  ])("rejects %s instead of encoding it lossily", (_label, value, message) => {
    expect(() => Reflect.apply(canonicalStringify, undefined, [{ value }])).toThrow(message);
  });

  it("rejects cyclic data", () => {
    interface CyclicValue {
      readonly name: string;
      self?: CyclicValue;
    }
    const cyclic: CyclicValue = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => Reflect.apply(canonicalStringify, undefined, [cyclic])).toThrow("cycles");
  });
});

describe("repository paths in evidence", () => {
  it.each([
    ["src\\api\\users.ts", "src/api/users.ts"],
    ["./src//api/./users.ts", "src/api/users.ts"],
    ["src/internal/../api/users.ts", "src/api/users.ts"],
    ["Src/API/users.ts", "Src/API/users.ts"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeRepositoryPath(input)).toBe(expected);
  });

  it.each([
    ["/etc/passwd", "repository-relative"],
    ["C:\\repo\\src\\a.ts", "repository-relative"],
    ["../outside.ts", "escapes"],
    ["src/../../outside.ts", "escapes"],
    ["", "must identify"],
    ["./.", "must identify"],
  ])("rejects %s", (input, message) => {
    expect(() => normalizeRepositoryPath(input)).toThrow(message);
  });
});

describe("binding digests", () => {
  it("treats routing fields as sets and detector options as ordered data", () => {
    const base = bindingDigest({ include: ["a/**", "b/**"], exclude: ["x"], dependencies: ["p", "q"] });
    expect(bindingDigest({ include: ["b/**", "a/**", "a/**"], exclude: ["x"], dependencies: ["q", "p"] })).toBe(base);
    expect(bindingDigest({ include: ["a/**"], exclude: ["x"], dependencies: ["p", "q"] })).not.toBe(base);
    expect(bindingDigest({ options: { include: ["a", "b"] } })).not.toBe(
      bindingDigest({ options: { include: ["b", "a"] } }),
    );
  });

  it("separates authority and options, and accepts non-object material", () => {
    expect(bindingDigest({ authority: "agent" })).not.toBe(bindingDigest({ authority: "human" }));
    expect(bindingDigest({ options: { limit: 5 } })).not.toBe(bindingDigest({ options: { limit: 6 } }));
    expect(bindingDigest(null)).not.toBe(bindingDigest([]));
  });
});

describe("evidence fingerprints", () => {
  const state = { path: "src/a.ts", structure: "(call)", occurrence: "0" };
  const change = {
    before: null,
    after: { statement: "DROP TABLE users;" },
    beforePath: "migrations/1.sql",
    afterPath: "migrations/1.sql",
    operation: "add" as const,
    occurrence: "migrations/1.sql:drop",
  };

  it("emits the supported scheme and version for each lifecycle", () => {
    expect(fingerprintState(state)).toMatchObject({ scheme: "source-structure", version: 3 });
    expect(fingerprintChange(change)).toMatchObject({ scheme: "git-change", version: 2 });
  });

  it("ignores path spelling and absent captures, and nothing else", () => {
    expect(fingerprintState({ ...state, path: ".\\src\\a.ts", captures: {} })).toEqual(fingerprintState(state));
    const variants = [
      { ...state, path: "src/b.ts" },
      { ...state, structure: "(call (arguments))" },
      { ...state, occurrence: "1" },
      { ...state, captures: { DB: "db.users" } },
    ];
    const digests = new Set([state, ...variants].map((evidence) => fingerprintState(evidence).digest));
    expect(digests.size).toBe(variants.length + 1);
  });

  it("separates every material part of a change", () => {
    expect(fingerprintChange({ ...change, afterPath: "./migrations/1.sql", captures: {} })).toEqual(
      fingerprintChange(change),
    );
    const variants = [
      { ...change, after: { statement: "DROP TABLE orders;" } },
      { ...change, before: { statement: "CREATE TABLE users;" } },
      { ...change, beforePath: "migrations/0.sql" },
      { ...change, afterPath: "migrations/2.sql" },
      { ...change, operation: "modify" as const },
      { ...change, occurrence: "migrations/1.sql:other" },
      { ...change, captures: { table: "users" } },
    ];
    const digests = new Set([change, ...variants].map((evidence) => fingerprintChange(evidence).digest));
    expect(digests.size).toBe(variants.length + 1);
  });

  it("refuses evidence outside the repository", () => {
    expect(() => fingerprintState({ ...state, path: "../a.ts" })).toThrow("escapes");
    expect(() => fingerprintChange({ ...change, beforePath: "/abs/1.sql" })).toThrow("repository-relative");
  });
});
