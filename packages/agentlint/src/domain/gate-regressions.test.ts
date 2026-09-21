import { describe, expect, it } from "vitest";
import { defineConfig, normalizeConfig } from "./config.js";
import { defineRule } from "./rule.js";
import { AcceptanceRecord, acceptanceSatisfies } from "./acceptance.js";
import { bindingDigest, canonicalStringify, Fingerprint } from "./fingerprint.js";
import { findingId, FindingRecord } from "./finding.js";
import { reconcileAcceptanceRecords } from "../shared/infrastructure/acceptance-store.js";
import { resolveFindingSelector } from "../shared/pipeline/selectors.js";
import { testRuleOnChange, testRuleOnSource, testRuleOnSources } from "../testing.js";

const rule = defineRule({
  lifecycle: "state",
  standard: { id: "review", revision: 1, title: "Review", guidance: "Verify authorization." },
  detector: { id: "danger", version: 1, match: { pattern: "danger($ARG)", message: "Review this call." } },
  binding: { id: "review", authority: "agent" },
});

function accept(finding: FindingRecord) {
  return new AcceptanceRecord({
    schemaVersion: 1,
    source: finding.source,
    fingerprint: finding.fingerprint,
    lineageKey: finding.lineageKey,
    reason: "The authorization contract was examined.",
    authority: "agent",
    actor: "agent:test",
    acceptedAt: "2026-09-05T12:00:00.000Z",
  });
}

describe("review identity and authoring regressions", () => {
  it("attributes throwing hooks and visitors to their binding", async () => {
    const broken = defineRule({
      ...rule,
      detector: {
        id: "broken",
        version: 1,
        createOnce() {
          return {
            call_expression() {
              throw new Error("probe");
            },
          };
        },
      },
    });
    await expect(testRuleOnSource(broken, "danger(1)")).rejects.toMatchObject({
      _tag: "agentlint/DetectionError",
      ruleId: "review",
    });
  });

  it("retains independent and duplicate occurrences after sequential acceptance", async () => {
    const findings = await testRuleOnSource(rule, 'danger("x"); danger("y"); danger("x");');
    expect(new Set(findings.map((finding) => finding.lineageKey)).size).toBe(3);
    let records: readonly AcceptanceRecord[] = [];
    for (const finding of findings)
      records = reconcileAcceptanceRecords(records, {
        scope: "partial",
        current: [finding],
        accepted: [accept(finding)],
      }).records;
    expect(records).toHaveLength(3);
    for (const finding of findings) expect(records.some((record) => acceptanceSatisfies(record, finding))).toBe(true);
  });

  it("invalidates guard removal while retaining whitespace-only edits", async () => {
    const [guarded] = await testRuleOnSource(rule, 'function run() { if (authorized) danger("x"); }');
    const [formatted] = await testRuleOnSource(rule, '\n function run() {\n if (authorized) danger( "x" );\n }');
    const [unguarded] = await testRuleOnSource(rule, 'function run() { danger("x"); }');
    if (!guarded || !formatted || !unguarded) throw new Error("Expected one finding per source");
    expect(guarded.fingerprint).toEqual(formatted.fingerprint);
    expect(guarded.fingerprint).not.toEqual(unguarded.fingerprint);
  });

  it("does not transfer an acceptance when an identical sibling disappears", async () => {
    const [first] = await testRuleOnSource(rule, 'danger("x"); danger("x");');
    const [remaining] = await testRuleOnSource(rule, 'danger("x");');
    if (!first || !remaining) throw new Error("Expected a finding in both sources");
    expect(first.fingerprint).not.toEqual(remaining.fingerprint);
  });

  it("includes explicit supporting files and requires them in fixtures", async () => {
    const dependent = defineRule({ ...rule, binding: { ...rule.binding, dependencies: ["policy.txt"] } });
    const [before] = await testRuleOnSources(dependent, [
      ["fixture.ts", 'danger("x")'],
      ["policy.txt", "authorized"],
    ]);
    const [after] = await testRuleOnSources(dependent, [
      ["fixture.ts", 'danger("x")'],
      ["policy.txt", "public"],
    ]);
    if (!before || !after) throw new Error("Expected a finding for both policy contents");
    expect(before.fingerprint).not.toEqual(after.fingerprint);
    await expect(testRuleOnSource(dependent, 'danger("x")')).rejects.toThrow("Missing fixture dependency");
  });

  it("keeps Unicode literals and option array ordering semantically distinct", async () => {
    const [a] = await testRuleOnSource(rule, 'danger("é")');
    const [b] = await testRuleOnSource(rule, 'danger("e\u0301")');
    if (!a || !b) throw new Error("Expected a finding for both literals");
    expect(a.fingerprint).not.toEqual(b.fingerprint);
    expect(bindingDigest({ options: { include: ["a", "b"] } })).not.toBe(
      bindingDigest({ options: { include: ["b", "a"] } }),
    );
    const sparse: unknown[] = [];
    sparse.length = 2;
    expect(() => canonicalStringify(sparse as never)).toThrow("not canonical JSON data");
  });

  it("rejects invalid runtime rules and options even before a detector reports", () => {
    expect(() => normalizeConfig({ rules: [{ ...rule, lifecycle: "typo" } as never] })).toThrow("invalid rule shape");
    expect(() => normalizeConfig({ rules: [{ ...rule, binding: { ...rule.binding, options: new Date() } }] })).toThrow(
      "plain objects",
    );
    expect(() => defineRule({ ...rule, binding: { ...rule.binding, dependencies: ["../policy"] } })).toThrow("escapes");
  });

  it("composes heterogeneous typed options without casting or exposing Effect", async () => {
    const received: number[] = [];
    const typed = defineRule({
      lifecycle: "change",
      standard: rule.standard,
      detector: {
        id: "typed",
        version: 1,
        detect(_context, options: { limit: number }) {
          received.push(options.limit);
        },
      },
      binding: { id: "typed", authority: "agent", options: { limit: 5 } },
    });
    expect(normalizeConfig(defineConfig({ rules: [rule, typed] })).rules.map((entry) => entry.binding.id)).toEqual([
      "review",
      "typed",
    ]);
    await testRuleOnChange(typed, { before: {}, after: { "a.ts": "export {}" } });
    expect(received).toEqual([5]);
  });

  it("rejects shared digest selectors and resolves complete identity hashes", async () => {
    const [first] = await testRuleOnSource(rule, 'danger("x")');
    if (!first) throw new Error("Expected finding");
    const second = new FindingRecord({ ...first, source: { ...first.source, bindingId: "another" } });
    const cache = { version: 1 as const, findings: [] };
    expect(resolveFindingSelector(first.fingerprint.digest, [first, second], cache).ok).toBe(false);
    expect(resolveFindingSelector(findingId(second), [first, second], cache)).toEqual({ ok: true, finding: second });
    expect(
      acceptanceSatisfies(
        accept(first),
        new FindingRecord({ ...first, fingerprint: new Fingerprint({ ...first.fingerprint, version: 1 }) }),
      ),
    ).toBe(false);
  });
});
