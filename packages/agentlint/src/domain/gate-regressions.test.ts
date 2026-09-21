import { describe, expect, it } from "vitest";
import { Array as A } from "effect";
import { defineConfig, normalizeConfig } from "./config.js";
import { defineRule } from "./rule.js";
import { AcceptanceRecord, acceptanceSatisfies } from "./acceptance.js";
import { bindingDigest, canonicalStringify, Fingerprint, FindingSource } from "./fingerprint.js";
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
    await expect(testRuleOnSource({ rule: broken, source: "danger(1)" })).rejects.toMatchObject({
      _tag: "agentlint/DetectionError",
      ruleId: "review",
    });
  });

  it("retains independent and duplicate occurrences after sequential acceptance", async () => {
    const findings = await testRuleOnSource({ rule, source: 'danger("x"); danger("y"); danger("x");' });
    expect(new Set(findings.map((finding) => finding.lineageKey)).size).toBe(3);
    const records = findings.reduce<readonly AcceptanceRecord[]>(
      (existing, finding) =>
        reconcileAcceptanceRecords({
          existing,
          input: {
            scope: "partial",
            current: [finding],
            accepted: [accept(finding)],
          },
        }).records,
      [],
    );
    expect(records).toHaveLength(3);
    for (const finding of findings)
      expect(records.some((record) => acceptanceSatisfies({ acceptance: record, finding }))).toBe(true);
  });

  it("invalidates guard removal while retaining whitespace-only edits", async () => {
    const guarded = A.getUnsafe(
      await testRuleOnSource({ rule, source: 'function run() { if (authorized) danger("x"); }' }),
      0,
    );
    const formatted = A.getUnsafe(
      await testRuleOnSource({ rule, source: '\n function run() {\n if (authorized) danger( "x" );\n }' }),
      0,
    );
    const unguarded = A.getUnsafe(await testRuleOnSource({ rule, source: 'function run() { danger("x"); }' }), 0);
    expect(guarded.fingerprint).toEqual(formatted.fingerprint);
    expect(guarded.fingerprint).not.toEqual(unguarded.fingerprint);
  });

  it("does not transfer an acceptance when an identical sibling disappears", async () => {
    const first = A.getUnsafe(await testRuleOnSource({ rule, source: 'danger("x"); danger("x");' }), 0);
    const remaining = A.getUnsafe(await testRuleOnSource({ rule, source: 'danger("x");' }), 0);
    expect(first.fingerprint).not.toEqual(remaining.fingerprint);
  });

  it("includes explicit supporting files and requires them in fixtures", async () => {
    const dependent = defineRule({ ...rule, binding: { ...rule.binding, dependencies: ["policy.txt"] } });
    const before = A.getUnsafe(
      await testRuleOnSources({
        rule: dependent,
        sources: [
          ["fixture.ts", 'danger("x")'],
          ["policy.txt", "authorized"],
        ],
      }),
      0,
    );
    const after = A.getUnsafe(
      await testRuleOnSources({
        rule: dependent,
        sources: [
          ["fixture.ts", 'danger("x")'],
          ["policy.txt", "public"],
        ],
      }),
      0,
    );
    expect(before.fingerprint).not.toEqual(after.fingerprint);
    await expect(testRuleOnSource({ rule: dependent, source: 'danger("x")' })).rejects.toThrow(
      "Missing fixture dependency",
    );
  });

  it("keeps Unicode literals and option array ordering semantically distinct", async () => {
    const a = A.getUnsafe(await testRuleOnSource({ rule, source: 'danger("é")' }), 0);
    const b = A.getUnsafe(await testRuleOnSource({ rule, source: 'danger("e\u0301")' }), 0);
    expect(a.fingerprint).not.toEqual(b.fingerprint);
    expect(bindingDigest({ options: { include: ["a", "b"] } })).not.toBe(
      bindingDigest({ options: { include: ["b", "a"] } }),
    );
    const sparse: unknown[] = [];
    sparse.length = 2;
    expect(() => Reflect.apply(canonicalStringify, undefined, [sparse])).toThrow("not canonical JSON data");
  });

  it("rejects invalid runtime rules and options even before a detector reports", () => {
    expect(() => Reflect.apply(normalizeConfig, undefined, [{ rules: [{ ...rule, lifecycle: "typo" }] }])).toThrow(
      "invalid rule shape",
    );
    expect(() =>
      Reflect.apply(normalizeConfig, undefined, [
        { rules: [{ ...rule, binding: { ...rule.binding, options: new URL("https://invalid.test") } }] },
      ]),
    ).toThrow("plain objects");
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
        detect({
          context: _context,
          options,
        }: {
          readonly context: import("../index.js").ChangeRuleContext;
          readonly options: { limit: number };
        }) {
          received.push(options.limit);
        },
      },
      binding: { id: "typed", authority: "agent", options: { limit: 5 } },
    });
    expect(normalizeConfig(defineConfig({ rules: [rule, typed] })).rules.map((entry) => entry.binding.id)).toEqual([
      "review",
      "typed",
    ]);
    await testRuleOnChange({ rule: typed, fixture: { before: {}, after: { "a.ts": "export {}" } } });
    expect(received).toEqual([5]);
  });

  it("rejects shared digest selectors and resolves complete identity hashes", async () => {
    const first = A.getUnsafe(await testRuleOnSource({ rule, source: 'danger("x")' }), 0);
    const second = new FindingRecord({
      selector: first.selector,
      ruleId: first.ruleId,
      lifecycle: first.lifecycle,
      authority: first.authority,
      source: new FindingSource({
        standardId: first.source.standardId,
        standardRevision: first.source.standardRevision,
        detectorId: first.source.detectorId,
        detectorVersion: first.source.detectorVersion,
        bindingId: "another",
        bindingDigest: first.source.bindingDigest,
      }),
      fingerprint: first.fingerprint,
      lineageKey: first.lineageKey,
      file: first.file,
      line: first.line,
      column: first.column,
      endLine: first.endLine,
      endColumn: first.endColumn,
      message: first.message,
      sourceSnippet: first.sourceSnippet,
    });
    const cache = { version: 1 as const, findings: [] };
    expect(resolveFindingSelector({ selector: first.fingerprint.digest, findings: [first, second], cache }).ok).toBe(
      false,
    );
    expect(resolveFindingSelector({ selector: findingId(second), findings: [first, second], cache })).toEqual({
      ok: true,
      finding: second,
    });
    expect(
      acceptanceSatisfies({
        acceptance: accept(first),
        finding: new FindingRecord({
          selector: first.selector,
          ruleId: first.ruleId,
          lifecycle: first.lifecycle,
          authority: first.authority,
          source: first.source,
          fingerprint: new Fingerprint({
            scheme: first.fingerprint.scheme,
            version: 1,
            digest: first.fingerprint.digest,
          }),
          lineageKey: first.lineageKey,
          file: first.file,
          line: first.line,
          column: first.column,
          endLine: first.endLine,
          endColumn: first.endColumn,
          message: first.message,
          sourceSnippet: first.sourceSnippet,
        }),
      }),
    ).toBe(false);
  });
});
