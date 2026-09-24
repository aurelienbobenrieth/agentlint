import { describe, expect, it } from "vitest";
import { FindingRecord, findingKey, findingId } from "../../domain/finding.js";
import { Fingerprint, FindingSource } from "../../domain/fingerprint.js";
import type { SelectorCachePayload } from "../infrastructure/selector-cache.js";
import { resolveFindingSelector } from "./selectors.js";

const source = new FindingSource({
  standardId: "security/danger",
  standardRevision: 1,
  detectorId: "typescript/danger-call",
  detectorVersion: 1,
  bindingId: "security/danger",
  bindingDigest: "binding",
});

function finding({
  digest,
  file,
  line,
}: {
  readonly digest: string;
  readonly file: string;
  readonly line: number;
}): FindingRecord {
  return new FindingRecord({
    selector: undefined,
    ruleId: "security/danger",
    lifecycle: "state",
    authority: "agent",
    source,
    fingerprint: new Fingerprint({ scheme: "source-structure", version: 3, digest }),
    lineageKey: undefined,
    file,
    line,
    column: 1,
    endLine: line,
    endColumn: 10,
    message: "danger needs judgment",
    sourceSnippet: "danger()",
  });
}

const first = finding({ digest: "abcdef1234567890", file: "src/a.ts", line: 3 });
const second = finding({ digest: "abcdef9999999999", file: "src/a.ts", line: 3 });
const third = finding({ digest: "0123456789abcdef", file: "src/b.ts", line: 7 });
const findings = [first, second, third];

const cache: SelectorCachePayload = {
  version: 1,
  findings: findings.map((entry, index) => ({
    selector: String(index + 1),
    hash: findingKey(entry),
    ruleId: entry.ruleId,
    file: entry.file,
    line: entry.line,
    column: entry.column,
  })),
};

describe("resolveFindingSelector", () => {
  it("resolves latest-check ordinals with or without brackets", () => {
    expect(resolveFindingSelector({ selector: "1", findings, cache })).toEqual({ ok: true, finding: first });
    expect(resolveFindingSelector({ selector: "[3]", findings, cache })).toEqual({ ok: true, finding: third });
    expect(resolveFindingSelector({ selector: " 2 ", findings, cache })).toEqual({ ok: true, finding: second });
  });

  it("resolves the full finding key and the full digest without a cache", () => {
    const empty: SelectorCachePayload = { version: 1, findings: [] };
    expect(resolveFindingSelector({ selector: findingKey(third), findings, cache: empty })).toEqual({
      ok: true,
      finding: third,
    });
    expect(resolveFindingSelector({ selector: findingId(third), findings, cache: empty })).toEqual({
      ok: true,
      finding: third,
    });
  });

  it("resolves complete identity prefixes and rejects standalone evidence digests", () => {
    expect(resolveFindingSelector({ selector: findingId(third).slice(0, 10), findings, cache })).toEqual({
      ok: true,
      finding: third,
    });
    expect(resolveFindingSelector({ selector: first.fingerprint.digest, findings, cache }).ok).toBe(false);
    expect(resolveFindingSelector({ selector: findingId(first).slice(0, 6), findings, cache }).ok).toBe(false);
  });

  it("resolves file:line when exactly one finding is on that line", () => {
    expect(resolveFindingSelector({ selector: "src/b.ts:7", findings, cache })).toEqual({ ok: true, finding: third });
    expect(resolveFindingSelector({ selector: "src\\b.ts:7", findings, cache })).toEqual({ ok: true, finding: third });
  });

  it("rejects an ambiguous file:line", () => {
    const result = resolveFindingSelector({ selector: "src/a.ts:3", findings, cache });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("ambiguous");
  });

  it("explains a stale or unknown selector", () => {
    const result = resolveFindingSelector({ selector: "9", findings, cache });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Rerun agentlint check");
  });
});
