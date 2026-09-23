/**
 * Current proposal storage.
 *
 * `.agentlint/proposals.jsonl` contains one sorted record for each exact finding identity an agent has proposed work
 * for. Proposals are context for a human decision; they never change gate state.
 *
 * @module
 * @since 0.2.0
 */

import { Context, Effect, FileSystem, Layer, Path, Result, Schema, type PlatformError } from "effect";
import { randomUUID } from "node:crypto";
import { Env } from "../../config/env.js";
import { compareStrings } from "../../domain/compare.js";
import type { FindingRecord } from "../../domain/finding.js";
import { findingIdentityKey } from "../../domain/fingerprint.js";
import { ProposalRecord, proposalKey } from "../../domain/proposal.js";
import { withFileLock } from "./file/lock/live.js";

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
const decodeRecord = Schema.decodeUnknownResult(Schema.fromJsonString(ProposalRecord));
const encodeRecord = Schema.encodeUnknownSync(Schema.fromJsonString(ProposalRecord));

/**
 * Parse a JSONL proposal file. Later records for the same identity win.
 */
function parseProposals(content: string): Result.Result<ProposalRecord[], ProposalStoreError> {
  const byKey = new Map<string, ProposalRecord>();
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const decoded = decodeRecord(line);
    if (Result.isFailure(decoded))
      return Result.fail(
        new ProposalStoreError({ reason: "invalid_record", detail: decoded.failure.message, line: index + 1 }),
      );
    byKey.set(proposalKey(decoded.success), decoded.success);
  }
  return Result.succeed(sortProposals([...byKey.values()]));
}

function sortProposals(records: ReadonlyArray<ProposalRecord>): ProposalRecord[] {
  const keys = new Map(records.map((record) => [record, proposalKey(record)]));
  const keyOf = (record: ProposalRecord) => keys.get(record) ?? proposalKey(record);
  return records.toSorted((left, right) => compareStrings({ left: keyOf(left), right: keyOf(right) }));
}

function serializeProposals(records: ReadonlyArray<ProposalRecord>): string {
  const sorted = sortProposals(records);
  return sorted.length === 0 ? "" : `${sorted.map((record) => encodeRecord(record)).join("\n")}\n`;
}

export class ProposalStore extends Context.Service<
  ProposalStore,
  {
    read(): Effect.Effect<ReadonlyArray<ProposalRecord>, ProposalStoreError>;
    /**
     * Replace any proposal with the same identity.
     */
    upsert(record: ProposalRecord): Effect.Effect<ReadonlyArray<ProposalRecord>, ProposalStoreError>;
    /**
     * Drop proposals whose exact identity is absent from a complete finding view.
     */
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
      const io = (error: PlatformError.PlatformError | string) =>
        new ProposalStoreError({
          reason: "io",
          detail: Schema.is(Schema.String)(error) ? error : error.message,
          line: undefined,
        });
      const locked = withFileLock({ fs, directory, lock: path.resolve(directory, "proposals.lock"), fail: io });

      const readRecords = (): Effect.Effect<ProposalRecord[], ProposalStoreError> =>
        fs.exists(file).pipe(
          // A failed probe is an I/O error, not an empty store: `upsert` would rewrite the file with one record.
          Effect.mapError(io),
          Effect.flatMap((exists) =>
            exists
              ? fs.readFileString(file).pipe(
                  Effect.mapError(io),
                  Effect.flatMap((content) => Effect.fromResult(parseProposals(content))),
                )
              : Effect.succeed([]),
          ),
        );

      const writeRecords = Effect.fn("ProposalStore.writeRecords")(function* (records: ReadonlyArray<ProposalRecord>) {
        const sorted = sortProposals(records);
        yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(io));
        // Replace the file atomically so a reader or an interrupted writer never sees half of it.
        const temporary = path.resolve(directory, `proposals.${randomUUID()}.tmp`);
        yield* fs
          .writeFileString(temporary, serializeProposals(sorted), { flag: "wx" })
          .pipe(
            Effect.andThen(fs.rename(temporary, file)),
            Effect.mapError(io),
            Effect.ensuring(fs.remove(temporary).pipe(Effect.orElseSucceed(() => undefined))),
          );
        return sorted;
      });

      return ProposalStore.of({
        read: readRecords,
        upsert: (record) =>
          locked(
            readRecords().pipe(
              Effect.flatMap((existing) =>
                writeRecords([
                  ...existing.filter((candidate) => proposalKey(candidate) !== proposalKey(record)),
                  record,
                ]),
              ),
            ),
          ),
        prune: (current) => {
          const keys = new Set(
            current.map((finding) => findingIdentityKey({ source: finding.source, fingerprint: finding.fingerprint })),
          );
          const live = (records: ReadonlyArray<ProposalRecord>) =>
            records.filter((record) => keys.has(proposalKey(record)));
          // The common case has nothing to drop, and then needs neither the lock nor a write.
          return readRecords().pipe(
            Effect.flatMap((existing) =>
              live(existing).length === existing.length
                ? Effect.succeed(existing)
                : locked(readRecords().pipe(Effect.flatMap((fresh) => writeRecords(live(fresh))))),
            ),
          );
        },
      });
    }),
  );
}
