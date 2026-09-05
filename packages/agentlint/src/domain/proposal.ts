/**
 * Agent proposals attached to unresolved findings.
 *
 * A proposal never opens a gate. It records what an agent did or suggests
 * for a finding it cannot accept itself, so the human reviewer sees the
 * agent's work next to the evidence instead of rediscovering it.
 *
 * @module
 * @since 0.3.0
 */

import { Schema } from "effect";
import type { FindingRecord } from "./finding.js";
import { Fingerprint, FindingSource, findingIdentityKey, sameFindingSource, sameFingerprint } from "./fingerprint.js";

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/));

/** One agent proposal for one exact finding identity. */
export class ProposalRecord extends Schema.Class<ProposalRecord>("ProposalRecord")({
  schemaVersion: Schema.Literal(1),
  source: FindingSource,
  fingerprint: Fingerprint,
  /** What the agent changed or recommends, in one or two sentences. */
  summary: NonEmptyString,
  /** Optional unified diff of the change the agent already applied or suggests. */
  diff: Schema.optional(Schema.String),
  actor: NonEmptyString,
  proposedAt: NonEmptyString,
}) {}

/** Exact persisted identity key. */
export function proposalKey(record: Pick<ProposalRecord, "source" | "fingerprint">): string {
  return findingIdentityKey(record.source, record.fingerprint);
}

/** Find the proposal recorded for this exact finding. */
export function findProposal(
  records: ReadonlyArray<ProposalRecord>,
  finding: Pick<FindingRecord, "source" | "fingerprint">,
): ProposalRecord | undefined {
  return records.find(
    (record) =>
      sameFindingSource(record.source, finding.source) && sameFingerprint(record.fingerprint, finding.fingerprint),
  );
}
