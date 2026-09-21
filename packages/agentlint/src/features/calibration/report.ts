/** Calibration measurement, independent of gate semantics. @module @since 0.2.0 */
import { Schema } from "effect";
import { CalibrationReport, type CalibrationObservation, type ReviewStatePayload } from "../review/contract.js";

export { CalibrationReport } from "../review/contract.js";

export const CalibrationSummary = Schema.Struct({
  version: Schema.Literal(1),
  rules: Schema.Array(
    Schema.Struct({
      project: Schema.String,
      ruleId: Schema.String,
      standardRevision: Schema.Number,
      detectorVersion: Schema.Number,
      bindingDigest: Schema.String,
      reviewed: Schema.Number,
      applies: Schema.Number,
      doesNotApply: Schema.Number,
      unsure: Schema.Number,
      /** Applies / decided labels, excluding unsure. Null means no decided labels. */
      applicabilityRate: Schema.NullOr(Schema.Number),
      reasons: Schema.Record(Schema.String, Schema.Number),
      invalidatedEvidence: Schema.Number,
      /** Lineages with at least two distinct observed invalidated identities. */
      repeatedInvalidationLineages: Schema.Number,
    }),
  ),
});
export type CalibrationSummary = Schema.Schema.Type<typeof CalibrationSummary>;

export const calibrationReport = (
  state: ReviewStatePayload,
  observations: ReadonlyArray<CalibrationObservation>,
): CalibrationReport => {
  const counts = new Map<string, number>();
  for (const finding of state.findings) counts.set(finding.ruleId, (counts.get(finding.ruleId) ?? 0) + 1);
  return {
    version: 1,
    project: state.project,
    base: state.base,
    generatedAt: state.generatedAt,
    candidates: [...counts]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([ruleId, count]) => ({ ruleId, count })),
    observations,
  };
};

const sourceKey = (source: CalibrationObservation["identity"]["source"]) => [
  source.standardId,
  source.standardRevision,
  source.detectorId,
  source.detectorVersion,
  source.bindingId,
  source.bindingDigest,
];

/** Each exact finding is counted once. Input order resolves replacement labels: later reports win. */
export const summarizeCalibration = (reports: ReadonlyArray<CalibrationReport>): CalibrationSummary => {
  const observations = new Map<string, { project: string; observation: CalibrationObservation }>();
  for (const report of reports)
    for (const observation of report.observations) {
      const identity = observation.identity;
      const key = JSON.stringify([
        report.project,
        sourceKey(identity.source),
        identity.fingerprint.scheme,
        identity.fingerprint.version,
        identity.fingerprint.digest,
      ]);
      observations.set(key, { project: report.project, observation });
    }
  const groups = new Map<string, { project: string; items: CalibrationObservation[] }>();
  for (const { project, observation } of observations.values()) {
    const key = JSON.stringify([project, sourceKey(observation.identity.source)]);
    const group = groups.get(key);
    if (group) group.items.push(observation);
    else groups.set(key, { project, items: [observation] });
  }
  return {
    version: 1,
    rules: [...groups]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([, group]) => {
        const first = group.items[0];
        if (!first) return [];
        const applies = group.items.filter((item) => item.classification === "applies").length;
        const doesNotApply = group.items.filter((item) => item.classification === "does_not_apply").length;
        const invalidated = group.items.filter((item) => item.invalidationReasons.length > 0);
        const lineages = new Map<string, number>();
        for (const item of invalidated) {
          if (item.identity.lineageKey !== null)
            lineages.set(item.identity.lineageKey, (lineages.get(item.identity.lineageKey) ?? 0) + 1);
        }
        const reasons: Record<string, number> = {};
        for (const item of group.items)
          if (item.classification === "does_not_apply" && item.reason !== null)
            reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
        return [
          {
            project: group.project,
            ruleId: first.ruleId,
            standardRevision: first.identity.source.standardRevision,
            detectorVersion: first.identity.source.detectorVersion,
            bindingDigest: first.identity.source.bindingDigest,
            reviewed: group.items.length,
            applies,
            doesNotApply,
            unsure: group.items.length - applies - doesNotApply,
            applicabilityRate: applies + doesNotApply === 0 ? null : applies / (applies + doesNotApply),
            reasons,
            invalidatedEvidence: invalidated.length,
            repeatedInvalidationLineages: [...lineages.values()].filter((count) => count > 1).length,
          },
        ];
      }),
  };
};
