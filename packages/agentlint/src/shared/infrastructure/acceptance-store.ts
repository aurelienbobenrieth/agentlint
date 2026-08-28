/**
 * Current acceptance storage.
 *
 * `.agentlint/acceptances.jsonl` contains one sorted current record for each
 * exact finding identity. Git provides history.
 *
 * @module
 * @since 0.2.0
 */

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import { AcceptanceRecord, acceptanceKey, acceptanceSatisfies, sameLineage } from "../../domain/acceptance.js";
import type { FindingRecord } from "../../domain/finding.js";
import { findingIdentityKey } from "../../domain/fingerprint.js";

export class AcceptanceStoreError extends Schema.TaggedError<AcceptanceStoreError>()("agentlint/AcceptanceStoreError", {
  reason: Schema.Literals(["invalid_record", "duplicate_record", "invalid_acceptance", "io"]),
  detail: Schema.String,
  line: Schema.UndefinedOr(Schema.Number),
}) {
  override get message(): string {
    if (this.reason === "invalid_record") {
      return `Invalid acceptance record on line ${this.line ?? "?"}: ${this.detail}`;
    }
    return `Acceptance store ${this.reason.replaceAll("_", " ")}: ${this.detail}`;
  }
}

export interface AcceptanceSnapshot {
  readonly records: ReadonlyArray<AcceptanceRecord>;
  readonly byKey: ReadonlyMap<string, AcceptanceRecord>;
}

export interface ReconcileInput {
  readonly scope: "partial" | "complete";
  readonly current: ReadonlyArray<Pick<FindingRecord, "source" | "fingerprint">>;
  readonly accepted?: ReadonlyArray<AcceptanceRecord>;
}

export interface ReconcileResult extends AcceptanceSnapshot {
  readonly removed: ReadonlyArray<AcceptanceRecord>;
}

const ACCEPTANCE_PATH = [".agentlint", "acceptances.jsonl"] as const;
const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(AcceptanceRecord));

function snapshot(records: ReadonlyArray<AcceptanceRecord>): AcceptanceSnapshot {
  return {
    records,
    byKey: new Map(records.map((record) => [acceptanceKey(record), record])),
  };
}

/**
 * Find the acceptance that opens the gate for `finding`, using the exact
 * identity index. Equivalent to scanning `records` with `acceptanceSatisfies`.
 */
export function lookupAcceptance(
  acceptances: AcceptanceSnapshot,
  finding: Pick<FindingRecord, "source" | "fingerprint" | "authority">,
): AcceptanceRecord | undefined {
  const record = acceptances.byKey.get(findingIdentityKey(finding.source, finding.fingerprint));
  return record !== undefined && acceptanceSatisfies(record, finding) ? record : undefined;
}

/** Parse and strictly validate a current-state JSONL file. */
export function parseAcceptances(content: string): AcceptanceRecord[] {
  const records: AcceptanceRecord[] = [];
  const seen = new Set<string>();

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    let record: AcceptanceRecord;
    try {
      record = decodeRecord(line);
    } catch (error) {
      throw new AcceptanceStoreError({
        reason: "invalid_record",
        detail: error instanceof Error ? error.message : String(error),
        line: index + 1,
      });
    }

    const key = acceptanceKey(record);
    if (seen.has(key)) {
      throw new AcceptanceStoreError({
        reason: "duplicate_record",
        detail: `duplicate exact finding identity on line ${index + 1}`,
        line: index + 1,
      });
    }
    seen.add(key);
    records.push(record);
  }

  return sortAcceptances(records);
}

/** Sort records by their complete identity, independently of insertion order. */
export function sortAcceptances(records: ReadonlyArray<AcceptanceRecord>): AcceptanceRecord[] {
  return sortByKey(records, keyIndex(records));
}

function keyIndex(records: ReadonlyArray<AcceptanceRecord>): Map<AcceptanceRecord, string> {
  return new Map(records.map((record) => [record, acceptanceKey(record)]));
}

function sortByKey(
  records: ReadonlyArray<AcceptanceRecord>,
  keys: ReadonlyMap<AcceptanceRecord, string>,
): AcceptanceRecord[] {
  const keyOf = (record: AcceptanceRecord) => keys.get(record) ?? acceptanceKey(record);
  return records.toSorted((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

/** Serialize sorted current state as JSONL. */
export function serializeAcceptances(records: ReadonlyArray<AcceptanceRecord>): string {
  const sorted = sortAcceptances(records);
  return sorted.length === 0 ? "" : `${sorted.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

/**
 * Apply new acceptances and check cleanup rules without performing I/O.
 *
 * A new record replaces an older record in the same explicit lineage. A
 * partial view never removes other records. A complete view removes records
 * whose exact identities are absent.
 */
export function reconcileAcceptanceRecords(
  existing: ReadonlyArray<AcceptanceRecord>,
  input: ReconcileInput,
): ReconcileResult {
  const currentKeys = new Set(input.current.map((finding) => findingIdentityKey(finding.source, finding.fingerprint)));
  const keys = keyIndex([...existing, ...(input.accepted ?? [])]);
  const keyOf = (record: AcceptanceRecord) => keys.get(record) ?? acceptanceKey(record);
  let records = [...existing];

  for (const record of input.accepted ?? []) {
    const key = keyOf(record);
    if (!currentKeys.has(key)) {
      throw new AcceptanceStoreError({
        reason: "invalid_acceptance",
        detail: "a new acceptance must identify a finding in the current check view",
        line: undefined,
      });
    }
    records = records.filter((candidate) => keyOf(candidate) !== key && !sameLineage(candidate, record));
    records.push(record);
  }

  if (input.scope === "complete") {
    records = records.filter((record) => currentKeys.has(keyOf(record)));
  }

  const keptKeys = new Set(records.map(keyOf));
  const removed = existing.filter((record) => !keptKeys.has(keyOf(record)));
  const sorted = sortByKey(records, keys);
  return { records: sorted, byKey: new Map(sorted.map((record) => [keyOf(record), record])), removed };
}

export class AcceptanceStore extends Context.Service<
  AcceptanceStore,
  {
    read(): Effect.Effect<AcceptanceSnapshot, AcceptanceStoreError>;
    write(records: ReadonlyArray<AcceptanceRecord>): Effect.Effect<AcceptanceSnapshot, AcceptanceStoreError>;
    reconcile(input: ReconcileInput): Effect.Effect<ReconcileResult, AcceptanceStoreError>;
  }
>()("agentlint/AcceptanceStore") {
  static readonly layer: Layer.Layer<AcceptanceStore, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    AcceptanceStore,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.resolve(env.cwd, ".agentlint");
      const file = path.resolve(env.cwd, ...ACCEPTANCE_PATH);

      const readRecords = (): Effect.Effect<AcceptanceRecord[], AcceptanceStoreError> =>
        fs.exists(file).pipe(
          Effect.orElseSucceed(() => false),
          Effect.flatMap((exists) => {
            if (!exists) return Effect.succeed([]);
            return fs.readFileString(file).pipe(
              Effect.mapError(
                (error) => new AcceptanceStoreError({ reason: "io", detail: String(error), line: undefined }),
              ),
              Effect.flatMap((content) =>
                Effect.try({
                  try: () => parseAcceptances(content),
                  catch: (error) =>
                    error instanceof AcceptanceStoreError
                      ? error
                      : new AcceptanceStoreError({ reason: "invalid_record", detail: String(error), line: undefined }),
                }),
              ),
            );
          }),
        );

      const writeRecords = (
        records: ReadonlyArray<AcceptanceRecord>,
      ): Effect.Effect<AcceptanceSnapshot, AcceptanceStoreError> =>
        Effect.gen(function* () {
          // Decode the serialized representation before replacing project state.
          const prepared = yield* Effect.try({
            try: () => {
              const serialized = serializeAcceptances(records);
              return { serialized, validated: parseAcceptances(serialized) };
            },
            catch: (error) =>
              error instanceof AcceptanceStoreError
                ? error
                : new AcceptanceStoreError({ reason: "invalid_record", detail: String(error), line: undefined }),
          });
          yield* fs
            .makeDirectory(directory, { recursive: true })
            .pipe(
              Effect.mapError(
                (error) => new AcceptanceStoreError({ reason: "io", detail: String(error), line: undefined }),
              ),
            );
          yield* fs
            .writeFileString(file, prepared.serialized)
            .pipe(
              Effect.mapError(
                (error) => new AcceptanceStoreError({ reason: "io", detail: String(error), line: undefined }),
              ),
            );
          return snapshot(prepared.validated);
        });

      return AcceptanceStore.of({
        read: () => readRecords().pipe(Effect.map(snapshot)),
        write: writeRecords,
        reconcile: (input) =>
          Effect.gen(function* () {
            const existing = yield* readRecords();
            const result = yield* Effect.try({
              try: () => reconcileAcceptanceRecords(existing, input),
              catch: (error) =>
                error instanceof AcceptanceStoreError
                  ? error
                  : new AcceptanceStoreError({ reason: "invalid_acceptance", detail: String(error), line: undefined }),
            });
            yield* writeRecords(result.records);
            return result;
          }),
      });
    }),
  );
}
