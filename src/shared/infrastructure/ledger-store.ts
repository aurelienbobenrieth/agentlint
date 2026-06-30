/**
 * Ledger store for explicit finding dispositions.
 *
 * `.agentlint/ledger.jsonl` is committed project state. Each line is a strict,
 * independently valid JSON record.
 *
 * @module
 * @since 0.2.0
 */

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Env } from "../../config/env.js";

export const LedgerStatus = Schema.Literals(["accepted", "deferred", "no_fix", "approved"]);
export type LedgerStatus = Schema.Schema.Type<typeof LedgerStatus>;

export class LedgerRecord extends Schema.Class<LedgerRecord>("LedgerRecord")({
  version: Schema.Literal(1),
  persistence: Schema.optional(Schema.Literal("durable")),
  ruleId: Schema.String,
  hash: Schema.String,
  status: LedgerStatus,
  reason: Schema.String,
  actor: Schema.String,
  at: Schema.String,
  summary: Schema.optional(Schema.String),
  adr: Schema.optional(Schema.String),
}) {}

export class LedgerError extends Schema.TaggedErrorClass<LedgerError>()("LedgerError", {
  message: Schema.String,
}) {}

export interface LedgerSnapshot {
  readonly records: ReadonlyArray<LedgerRecord>;
  readonly latestByKey: ReadonlyMap<string, LedgerRecord>;
}

const LEDGER_PATH = [".agentlint", "ledger.jsonl"] as const;
const LedgerDecoder = Schema.decodeUnknownSync(LedgerRecord);

export function ledgerKey(ruleId: string, hash: string): string {
  return `${ruleId}:${hash}`;
}

function latestByKey(records: ReadonlyArray<LedgerRecord>): Map<string, LedgerRecord> {
  const latest = new Map<string, LedgerRecord>();
  for (const record of records) {
    latest.set(ledgerKey(record.ruleId, record.hash), record);
  }
  return latest;
}

function parseLedger(content: string): LedgerRecord[] {
  const records: LedgerRecord[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    try {
      records.push(LedgerDecoder(JSON.parse(line)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LedgerError({ message: `Invalid ledger record on line ${index + 1}: ${message}` });
    }
  }

  return records;
}

function serializeLedger(records: ReadonlyArray<LedgerRecord>): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
}

export class LedgerStore extends Context.Service<
  LedgerStore,
  {
    read(): Effect.Effect<LedgerSnapshot, LedgerError>;
    append(record: LedgerRecord): Effect.Effect<{ appended: boolean }, LedgerError>;
    write(records: ReadonlyArray<LedgerRecord>): Effect.Effect<void, LedgerError>;
  }
>()("agentlint/LedgerStore") {
  static readonly layer: Layer.Layer<LedgerStore, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    LedgerStore,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const ledgerDir = path.resolve(env.cwd, ".agentlint");
      const ledgerPath = path.resolve(env.cwd, ...LEDGER_PATH);

      const readRecords = (): Effect.Effect<LedgerRecord[], LedgerError> =>
        fs.exists(ledgerPath).pipe(
          Effect.orElseSucceed(() => false),
          Effect.flatMap((exists) => {
            if (!exists) return Effect.succeed([] as LedgerRecord[]);
            return fs.readFileString(ledgerPath).pipe(
              Effect.mapError((error) => new LedgerError({ message: String(error) })),
              Effect.flatMap((content) =>
                Effect.try({
                  try: () => parseLedger(content),
                  catch: (error) =>
                    new LedgerError({
                      message: error instanceof LedgerError ? error.message : String(error),
                    }),
                }),
              ),
            );
          }),
        );

      return LedgerStore.of({
        read: () =>
          readRecords().pipe(
            Effect.map((records) => ({
              records,
              latestByKey: latestByKey(records),
            })),
          ),

        append: (record) =>
          Effect.gen(function* () {
            LedgerDecoder(record);
            const snapshotRecords = yield* readRecords();
            const latest = latestByKey(snapshotRecords).get(ledgerKey(record.ruleId, record.hash));
            if (latest && latest.status === record.status && latest.reason === record.reason) {
              return { appended: false };
            }

            yield* fs
              .makeDirectory(ledgerDir, { recursive: true })
              .pipe(Effect.mapError((error) => new LedgerError({ message: String(error) })));
            yield* fs
              .writeFileString(ledgerPath, serializeLedger([...snapshotRecords, record]))
              .pipe(Effect.mapError((error) => new LedgerError({ message: String(error) })));
            return { appended: true };
          }),

        write: (records) =>
          Effect.gen(function* () {
            for (const record of records) {
              LedgerDecoder(record);
            }
            yield* fs
              .makeDirectory(ledgerDir, { recursive: true })
              .pipe(Effect.mapError((error) => new LedgerError({ message: String(error) })));
            yield* fs
              .writeFileString(ledgerPath, serializeLedger(records))
              .pipe(Effect.mapError((error) => new LedgerError({ message: String(error) })));
          }),
      });
    }),
  );
}
