import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { type CalibrationObservation, CalibrationReport } from "../review/contract.js";
import { summarizeCalibration } from "./report.js";

const observation = (
  digest: string,
  classification: CalibrationObservation["classification"],
): CalibrationObservation => ({
  findingId: digest,
  ruleId: "test/rule",
  file: "src/a.ts",
  classification,
  reason: classification === "does_not_apply" ? "scope" : null,
  note: "Reviewed context",
  invalidationReasons: ["The file evidence changed."],
  identity: {
    source: {
      standardId: "test/standard",
      standardRevision: 1,
      detectorId: "test/detector",
      detectorVersion: 1,
      bindingId: "test/rule",
      bindingDigest: "binding",
    },
    fingerprint: { scheme: "source-structure", version: 3, digest },
    lineageKey: "same-occurrence",
  },
});
const report = (observations: ReadonlyArray<CalibrationObservation>): CalibrationReport => ({
  version: 1,
  project: "project",
  base: "main",
  generatedAt: "2026-09-07T00:00:00Z",
  candidates: [{ ruleId: "test/rule", count: 8 }],
  observations,
});

describe("calibration measurements", () => {
  it("deduplicates exact evidence across exports, counts decided labels and distinct invalidations", () => {
    const first = report([observation("a", "applies"), observation("b", "unsure")]);
    const second = report([observation("a", "does_not_apply"), observation("c", "applies")]);
    expect(summarizeCalibration([first, first, second]).rules[0]).toMatchObject({
      reviewed: 3,
      applies: 1,
      doesNotApply: 1,
      unsure: 1,
      applicabilityRate: 0.5,
      reasons: { scope: 1 },
      invalidatedEvidence: 3,
      repeatedInvalidationLineages: 1,
    });
  });
  it("keeps material policy versions separate and does not invent a rate for unsure labels", () => {
    const first = observation("a", "unsure");
    const changed = {
      ...first,
      identity: { ...first.identity, source: { ...first.identity.source, standardRevision: 2 } },
    };
    const result = summarizeCalibration([report([first, changed])]);
    expect(result.rules).toHaveLength(2);
    expect(result.rules.map((rule) => rule.applicabilityRate)).toEqual([null, null]);
    expect(result.rules.map((rule) => rule.repeatedInvalidationLineages)).toEqual([0, 0]);
  });
  it("rejects unrelated or unsupported report formats", () => {
    const decode = Schema.decodeUnknownSync(CalibrationReport);
    expect(() => decode({ ...report([]), version: 2 })).toThrow(/Expected|Missing|Invalid/u);
    expect(() => decode({ ...report([]), observations: [{ classification: "accepted" }] })).toThrow(
      /Expected|Missing|Invalid/u,
    );
  });
});
