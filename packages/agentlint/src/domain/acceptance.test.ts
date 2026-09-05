import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AcceptanceRecord, acceptanceSatisfies, authoritySatisfies, findLineage } from "./acceptance.js";
import { FindingRecord } from "./finding.js";
import { Fingerprint, FindingSource } from "./fingerprint.js";

const source = new FindingSource({
  standardId: "data/bounded-query",
  standardRevision: 1,
  detectorId: "prisma/find-many",
  detectorVersion: 1,
  bindingId: "app-queries",
  bindingDigest: "binding-a",
});
const fingerprint = new Fingerprint({ scheme: "source-structure", version: 2, digest: "evidence-a" });

function finding(overrides: Partial<ConstructorParameters<typeof FindingRecord>[0]> = {}) {
  return new FindingRecord({
    selector: undefined,
    ruleId: "bounded-query",
    lifecycle: "state",
    authority: "agent",
    source,
    fingerprint,
    lineageKey: "list-users-query",
    file: "src/query.ts",
    absolutePath: "/repo/src/query.ts",
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
    source,
    fingerprint,
    lineageKey: "list-users-query",
    reason: "The caller applies a fixed upstream bound.",
    authority: "agent",
    actor: "agent:test",
    acceptedAt: "2026-08-10T12:00:00.000Z",
    ...overrides,
  });
}

describe("acceptance compatibility", () => {
  it("rejects a reason with no judgment text", () => {
    expect(() => Schema.decodeUnknownSync(AcceptanceRecord)({ ...acceptance(), reason: "   " })).toThrow(
      "Expected a string matching the RegExp",
    );
  });

  it("requires exact source and fingerprint versions", () => {
    expect(acceptanceSatisfies(acceptance(), finding())).toBe(true);

    const cases = [
      { source: new FindingSource({ ...source, standardId: "data/another-standard" }) },
      { source: new FindingSource({ ...source, standardRevision: 2 }) },
      { source: new FindingSource({ ...source, detectorId: "drizzle/select" }) },
      { source: new FindingSource({ ...source, detectorVersion: 2 }) },
      { source: new FindingSource({ ...source, bindingId: "worker-queries" }) },
      { source: new FindingSource({ ...source, bindingDigest: "binding-b" }) },
      { fingerprint: new Fingerprint({ ...fingerprint, scheme: "git-change" }) },
      { fingerprint: new Fingerprint({ ...fingerprint, version: 1 }) },
      { fingerprint: new Fingerprint({ ...fingerprint, digest: "evidence-b" }) },
    ];
    for (const changed of cases) {
      expect(acceptanceSatisfies(acceptance(changed), finding())).toBe(false);
    }
  });

  it("applies the authority lattice", () => {
    expect(authoritySatisfies("agent", "agent")).toBe(true);
    expect(authoritySatisfies("human", "agent")).toBe(true);
    expect(authoritySatisfies("human", "human")).toBe(true);
    expect(authoritySatisfies("agent", "human")).toBe(false);
  });

  it("keeps unknown schemes and versions unresolved", () => {
    const unknownScheme = new Fingerprint({ scheme: "future-evidence", version: 1, digest: "same" });
    const unknownVersion = new Fingerprint({ scheme: "source-structure", version: 3, digest: "same" });
    expect(
      acceptanceSatisfies(acceptance({ fingerprint: unknownScheme }), finding({ fingerprint: unknownScheme })),
    ).toBe(false);
    expect(
      acceptanceSatisfies(acceptance({ fingerprint: unknownVersion }), finding({ fingerprint: unknownVersion })),
    ).toBe(false);
  });

  it("returns stale lineage as context without satisfying the finding", () => {
    const prior = acceptance({
      fingerprint: new Fingerprint({ ...fingerprint, digest: "prior" }),
      acceptedAt: "2026-08-10T13:00:00.000Z",
    });
    expect(acceptanceSatisfies(prior, finding())).toBe(false);
    expect(findLineage([prior], finding())).toBe(prior);
  });

  it("does not infer lineage without an explicit matching key", () => {
    expect(findLineage([acceptance({ lineageKey: "another-query" })], finding())).toBeUndefined();
    expect(findLineage([acceptance()], finding({ lineageKey: undefined }))).toBeUndefined();
  });
});
