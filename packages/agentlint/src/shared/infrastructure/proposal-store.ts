/**
 * Current proposal storage.
 *
 * `.agentlint/proposals.jsonl` contains one sorted record for each exact
 * finding identity an agent has proposed work for. Proposals are context for
 * a human decision; they never change gate state.
 *
 * @module
 * @since 0.3.0
 */

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import type { FindingRecord } from "../../domain/finding.js";
import { findingIdentityKey } from "../../domain/fingerprint.js";
import { ProposalRecord, proposalKey } from "../../domain/proposal.js";

export class ProposalStoreError extends Schema.TaggedError<ProposalStoreError>()("agentlint/ProposalStoreError", {
  reason: Schema.Literals(["invalid_record", "io"]),
  detail: Schema.String,
  line: Schema.UndefinedOr(Schema.Number),
}) {
  override get message(): string {
    if (this.reason === "invalid_record") {
      return `Invalid proposal record on line ${this.line ?? "?"}: ${this.detail}`;
    }
    return `Proposal store io: ${this.detail}`;
  }
}

const PROPOSAL_PATH = [".agentlint", "proposals.jsonl"] as const;
const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(ProposalRecord));

/** Parse a JSONL proposal file. Later records for the same identity win. */
export function parseProposals(content: string): ProposalRecord[] {
  const byKey = new Map<string, ProposalRecord>();
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      const record = decodeRecord(line);
      byKey.set(proposalKey(record), record);
    } catch (error) {
      throw new ProposalStoreError({
        reason: "invalid_record",
        detail: error instanceof Error ? error.message : String(error),
        line: index + 1,
      });
    }
  }
  return sortProposals([...byKey.values()]);
}

export function sortProposals(records: ReadonlyArray<ProposalRecord>): ProposalRecord[] {
  return records.toSorted((left, right) => proposalKey(left).localeCompare(proposalKey(right)));
}

export function serializeProposals(records: ReadonlyArray<ProposalRecord>): string {
  const sorted = sortProposals(records);
  return sorted.length === 0 ? "" : `${sorted.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export class ProposalStore extends Context.Service<
  ProposalStore,
  {
    read(): Effect.Effect<ReadonlyArray<ProposalRecord>, ProposalStoreError>;
    /** Replace any proposal with the same identity. */
    upsert(record: ProposalRecord): Effect.Effect<ReadonlyArray<ProposalRecord>, ProposalStoreError>;
    /** Drop proposals whose exact identity is absent from a complete finding view. */
    prune(
      current: ReadonlyArray<Pick<FindingRecord, "source" | "fingerprint">>,
    ): Effect.Effect<ReadonlyArray<ProposalRecord>, ProposalStoreError>;
  }
>()("agentlint/ProposalStore") {
  static readonly layer: Layer.Layer<ProposalStore, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    ProposalStore,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.resolve(env.cwd, ".agentlint");
      const file = path.resolve(env.cwd, ...PROPOSAL_PATH);
      const io = (error: unknown) => new ProposalStoreError({ reason: "io", detail: String(error), line: undefined });

      const readRecords = (): Effect.Effect<ProposalRecord[], ProposalStoreError> =>
        fs.exists(file).pipe(
          Effect.orElseSucceed(() => false),
          Effect.flatMap((exists) =>
            exists
              ? fs.readFileString(file).pipe(
                  Effect.mapError(io),
                  Effect.flatMap((content) =>
                    Effect.try({
                      try: () => parseProposals(content),
                      catch: (error) =>
                        error instanceof ProposalStoreError
                          ? error
                          : new ProposalStoreError({
                              reason: "invalid_record",
                              detail: String(error),
                              line: undefined,
                            }),
                    }),
                  ),
                )
              : Effect.succeed([]),
          ),
        );

      const writeRecords = (records: ReadonlyArray<ProposalRecord>) =>
        Effect.gen(function* () {
          const sorted = sortProposals(records);
          yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(io));
          yield* fs.writeFileString(file, serializeProposals(sorted)).pipe(Effect.mapError(io));
          return sorted;
        });

      return ProposalStore.of({
        read: readRecords,
        upsert: (record) =>
          readRecords().pipe(
            Effect.flatMap((existing) =>
              writeRecords([...existing.filter((candidate) => proposalKey(candidate) !== proposalKey(record)), record]),
            ),
          ),
        prune: (current) =>
          readRecords().pipe(
            Effect.flatMap((existing) => {
              const keys = new Set(current.map((finding) => findingIdentityKey(finding.source, finding.fingerprint)));
              const kept = existing.filter((record) => keys.has(proposalKey(record)));
              return kept.length === existing.length ? Effect.succeed(kept) : writeRecords(kept);
            }),
          ),
      });
    }),
  );
}
