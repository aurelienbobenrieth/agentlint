import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AcceptanceDecision } from "../../domain/acceptance.js";
import { DetachedDecision } from "./contract.js";

const decodes = (schema: Schema.Decoder<unknown>) => (value: unknown) =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

const source = {
  standardId: "data/bounded-query",
  standardRevision: 1,
  detectorId: "prisma/find-many",
  detectorVersion: 1,
  bindingId: "app/database",
  bindingDigest: "binding-digest",
};
const fingerprint = { scheme: "source-structure", version: 2, digest: "finding-digest" };
const acceptance = {
  schemaVersion: 1,
  type: "accept",
  source,
  fingerprint,
  reason: "Capped upstream.",
  authority: "human",
  actor: "local-review",
  acceptedAt: "2026-09-05T12:00:00.000Z",
  reviewedSource: "export const users = () => db.user.findMany();\n",
};
const revocation = {
  schemaVersion: 1,
  type: "revoke",
  source,
  fingerprint,
  expectedAcceptedAt: "2026-09-05T12:00:00.000Z",
  expectedReason: "Previously examined",
  reviewedSource: "",
};

const records: ReadonlyArray<readonly [label: string, record: unknown]> = [
  ["acceptance", acceptance],
  ["acceptance with lineage and epoch", { ...acceptance, lineageKey: "k", source: { ...source, reviewEpoch: 2 } }],
  ["acceptance without actor", { ...acceptance, actor: undefined }],
  ["agent acceptance", { ...acceptance, authority: "agent" }],
  ["revocation", revocation],
  ["empty reason", { ...acceptance, reason: "" }],
  ["blank reason", { ...acceptance, reason: "  \n" }],
  ["unknown authority", { ...acceptance, authority: "robot" }],
  ["non-UTC timestamp", { ...acceptance, acceptedAt: "2026-09-05T12:00:00+02:00" }],
  ["date-only timestamp", { ...acceptance, acceptedAt: "2026-09-05" }],
  ["missing reviewed source", { ...acceptance, reviewedSource: undefined }],
  ["wrong schema version", { ...acceptance, schemaVersion: 2 }],
  ["zero standard revision", { ...acceptance, source: { ...source, standardRevision: 0 } }],
  ["fractional detector version", { ...acceptance, source: { ...source, detectorVersion: 1.5 } }],
  ["empty binding digest", { ...acceptance, source: { ...source, bindingDigest: "" } }],
  ["zero review epoch", { ...acceptance, source: { ...source, reviewEpoch: 0 } }],
  ["empty fingerprint digest", { ...acceptance, fingerprint: { ...fingerprint, digest: "" } }],
  ["blank expected reason", { ...revocation, expectedReason: " " }],
  ["empty expected timestamp", { ...revocation, expectedAcceptedAt: "" }],
  ["unknown decision type", { ...acceptance, type: "withdraw" }],
];

describe("detached decision contract", () => {
  it.each(records)("agrees with the domain decision schema on %s", (_label, record) => {
    expect(decodes(DetachedDecision)(record)).toBe(decodes(AcceptanceDecision)(record));
  });

  it("accepts the valid fixtures and rejects the invalid ones", () => {
    expect(records.filter(([, record]) => decodes(DetachedDecision)(record)).map(([label]) => label)).toEqual([
      "acceptance",
      "acceptance with lineage and epoch",
      "acceptance without actor",
      "agent acceptance",
      "revocation",
    ]);
  });
});
