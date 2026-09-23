/**
 * Repository storage for delayed review outcomes. @module @since 0.2.0
 */
import { Context, Effect, FileSystem, Layer, Path, Schema, type PlatformError } from "effect";
import { randomUUID } from "node:crypto";
import { Env } from "../../config/env.js";
import { compareStrings } from "../../domain/compare.js";
import { OutcomeRecord, outcomeKey } from "../../domain/outcome.js";
import { withFileLock } from "./file/lock/live.js";

export class OutcomeStoreError extends Schema.TaggedError<OutcomeStoreError>()("agentlint/OutcomeStoreError", {
  reason: Schema.Literals(["invalid_record", "io"]),
  detail: Schema.String,
  line: Schema.UndefinedOr(Schema.Number),
}) {
  override get message(): string {
    return this.reason === "invalid_record"
      ? `Invalid outcome record on line ${this.line ?? "?"}: ${this.detail}`
      : `Outcome store io: ${this.detail}`;
  }
}

const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(OutcomeRecord));
const encodeRecord = Schema.encodeUnknownSync(Schema.fromJsonString(OutcomeRecord));

function sort(records: ReadonlyArray<OutcomeRecord>): OutcomeRecord[] {
  return records.toSorted((left, right) => compareStrings({ left: outcomeKey(left), right: outcomeKey(right) }));
}

function parse(content: string): OutcomeRecord[] {
  const records = new Map<string, OutcomeRecord>();
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    try {
      const record = decodeRecord(raw);
      records.set(outcomeKey(record), record);
    } catch (error) {
      throw new OutcomeStoreError({
        reason: "invalid_record",
        detail: error instanceof Error ? error.message : String(error),
        line: index + 1,
      });
    }
  }
  return sort([...records.values()]);
}

export class OutcomeStore extends Context.Service<
  OutcomeStore,
  {
    read(): Effect.Effect<ReadonlyArray<OutcomeRecord>, OutcomeStoreError>;
    upsert(record: OutcomeRecord): Effect.Effect<ReadonlyArray<OutcomeRecord>, OutcomeStoreError>;
  }
>()("agentlint/OutcomeStore") {
  static readonly layer: Layer.Layer<OutcomeStore, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    OutcomeStore,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.resolve(env.cwd, ".agentlint");
      const file = path.resolve(directory, "outcomes.jsonl");
      const io = (error: PlatformError.PlatformError | string) =>
        new OutcomeStoreError({
          reason: "io",
          detail: Schema.is(Schema.String)(error) ? error : error.message,
          line: undefined,
        });
      const locked = withFileLock({ fs, directory, lock: path.resolve(directory, "outcomes.lock"), fail: io });
      const read = (): Effect.Effect<OutcomeRecord[], OutcomeStoreError> =>
        fs.exists(file).pipe(
          Effect.orElseSucceed(() => false),
          Effect.flatMap((exists) =>
            exists
              ? fs.readFileString(file).pipe(
                  Effect.mapError(io),
                  Effect.flatMap((content) =>
                    Effect.try({
                      try: () => parse(content),
                      catch: (error) =>
                        error instanceof OutcomeStoreError
                          ? error
                          : new OutcomeStoreError({ reason: "invalid_record", detail: String(error), line: undefined }),
                    }),
                  ),
                )
              : Effect.succeed([]),
          ),
        );
      const write = Effect.fn("OutcomeStore.write")(function* (records: ReadonlyArray<OutcomeRecord>) {
        const ordered = sort(records);
        yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(io));
        const temporary = path.resolve(directory, `outcomes.${randomUUID()}.tmp`);
        const content = ordered.length ? `${ordered.map((record) => encodeRecord(record)).join("\n")}\n` : "";
        yield* fs
          .writeFileString(temporary, content, { flag: "wx" })
          .pipe(
            Effect.andThen(fs.rename(temporary, file)),
            Effect.mapError(io),
            Effect.ensuring(fs.remove(temporary).pipe(Effect.orElseSucceed(() => undefined))),
          );
        return ordered;
      });
      return OutcomeStore.of({
        read,
        upsert: (record) =>
          locked(
            read().pipe(
              Effect.flatMap((records) =>
                write([...records.filter((candidate) => outcomeKey(candidate) !== outcomeKey(record)), record]),
              ),
            ),
          ),
      });
    }),
  );
}
