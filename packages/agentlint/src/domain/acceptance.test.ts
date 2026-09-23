import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AcceptanceRecord,
  acceptanceSatisfies,
  authoritySatisfies,
  findLineage,
  invalidationReasons,
} from "./acceptance.js";
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
const fingerprint = new Fingerprint({ scheme: "source-structure", version: 3, digest: "evidence-a" });

const sourceWith = (overrides: Partial<ConstructorParameters<typeof FindingSource>[0]>) =>
  new FindingSource({
    standardId: source.standardId,
    standardRevision: source.standardRevision,
    detectorId: source.detectorId,
    detectorVersion: source.detectorVersion,
    bindingId: source.bindingId,
    bindingDigest: source.bindingDigest,
    ...overrides,
  });

const fingerprintWith = (overrides: Partial<ConstructorParameters<typeof Fingerprint>[0]>) =>
  new Fingerprint({
    scheme: fingerprint.scheme,
    version: fingerprint.version,
    digest: fingerprint.digest,
    ...overrides,
  });

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
    line: 4,
    column: 3,
    endLine: 4,
    endColumn: 21,
    message: "Review this unbounded query.",
    sourceSnippet: "db.user.findMany()",
    ...overrides,
  });
}

const acceptanceInput = (
  overrides: Partial<ConstructorParameters<typeof AcceptanceRecord>[0]> = {},
): ConstructorParameters<typeof AcceptanceRecord>[0] => ({
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

function acceptance(overrides: Partial<ConstructorParameters<typeof AcceptanceRecord>[0]> = {}) {
  return new AcceptanceRecord(acceptanceInput(overrides));
}

describe("acceptance compatibility", () => {
  it("rejects a reason with no judgment text", () => {
    expect(() => Schema.decodeUnknownSync(AcceptanceRecord)(acceptanceInput({ reason: "   " }))).toThrow(
      "Expected a string matching the RegExp",
    );
  });

  it("requires exact source and fingerprint versions", () => {
    expect(acceptanceSatisfies({ acceptance: acceptance(), finding: finding() })).toBe(true);

    const cases = [
      { source: sourceWith({ standardId: "data/another-standard" }) },
      { source: sourceWith({ standardRevision: 2 }) },
      { source: sourceWith({ detectorId: "drizzle/select" }) },
      { source: sourceWith({ detectorVersion: 2 }) },
      { source: sourceWith({ bindingId: "worker-queries" }) },
      { source: sourceWith({ bindingDigest: "binding-b" }) },
      { source: sourceWith({ bindingDigest: "binding-b", reviewEpoch: 2 }) },
      { fingerprint: fingerprintWith({ scheme: "git-change" }) },
      { fingerprint: fingerprintWith({ version: 1 }) },
      { fingerprint: fingerprintWith({ digest: "evidence-b" }) },
    ];
    for (const changed of cases) {
      expect(acceptanceSatisfies({ acceptance: acceptance(changed), finding: finding() })).toBe(false);
    }
  });

  it("explains a repository-controlled review epoch separately from other binding changes", () => {
    const prior = acceptance({ source: sourceWith({ bindingDigest: "binding-epoch-1", reviewEpoch: 1 }) });
    const current = finding({ source: sourceWith({ bindingDigest: "binding-epoch-2", reviewEpoch: 2 }) });
    expect(invalidationReasons({ prior, current })).toContain("The repository advanced the review epoch.");
  });

  it("applies the authority lattice", () => {
    expect(authoritySatisfies({ actual: "agent", required: "agent" })).toBe(true);
    expect(authoritySatisfies({ actual: "human", required: "agent" })).toBe(true);
    expect(authoritySatisfies({ actual: "human", required: "human" })).toBe(true);
    expect(authoritySatisfies({ actual: "agent", required: "human" })).toBe(false);
  });

  it("keeps unknown schemes and versions unresolved", () => {
    const unknownScheme = new Fingerprint({ scheme: "future-evidence", version: 1, digest: "same" });
    const unknownVersion = new Fingerprint({ scheme: "source-structure", version: 4, digest: "same" });
    expect(
      acceptanceSatisfies({
        acceptance: acceptance({ fingerprint: unknownScheme }),
        finding: finding({ fingerprint: unknownScheme }),
      }),
    ).toBe(false);
    expect(
      acceptanceSatisfies({
        acceptance: acceptance({ fingerprint: unknownVersion }),
        finding: finding({ fingerprint: unknownVersion }),
      }),
    ).toBe(false);
  });

  it("returns stale lineage as context without satisfying the finding", () => {
    const prior = acceptance({
      fingerprint: fingerprintWith({ digest: "prior" }),
      acceptedAt: "2026-08-10T13:00:00.000Z",
    });
    expect(acceptanceSatisfies({ acceptance: prior, finding: finding() })).toBe(false);
    expect(findLineage({ records: [prior], finding: finding() })).toBe(prior);
  });

  it("does not infer lineage without an explicit matching key", () => {
    expect(findLineage({ records: [acceptance({ lineageKey: "another-query" })], finding: finding() })).toBeUndefined();
    expect(findLineage({ records: [acceptance()], finding: finding({ lineageKey: undefined }) })).toBeUndefined();
  });
});
