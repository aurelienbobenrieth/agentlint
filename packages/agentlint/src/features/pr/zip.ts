/**
 * Minimal ZIP reader for GitHub Actions artifacts.
 *
 * Walks the central directory, so entries written with data descriptors (sizes absent from the local header) still
 * resolve. Supports the stored and deflate methods, which is all the artifact service produces.
 *
 * @module
 * @since 0.2.0
 */

import { inflateRawSync } from "node:zlib";
import { Result, Schema } from "effect";

/**
 * @since 0.2.0 @category errors
 */
export class ZipError extends Schema.TaggedError<ZipError>()("agentlint/ZipError", {
  reason: Schema.Literals(["not_zip", "truncated", "entry_missing", "unsupported_method", "inflate_failed"]),
  entry: Schema.String,
  method: Schema.optional(Schema.Number),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return {
      not_zip: "The downloaded file is not a ZIP archive",
      truncated: `The archive is truncated or corrupt near ${this.entry}`,
      entry_missing: `The archive has no ${this.entry} entry`,
      unsupported_method: `${this.entry} uses unsupported compression method ${this.method}`,
      inflate_failed: `${this.entry} cannot be decompressed: ${this.detail}`,
    }[this.reason];
  }
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_RECORD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const STORED = 0;
const DEFLATE = 8;
/**
 * Review artifacts are a few megabytes. The cap stops a crafted archive from exhausting memory.
 */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

const findEndRecord = (archive: Buffer): number => {
  const cursor = { offset: archive.length - END_RECORD_SIZE };
  while (cursor.offset >= 0) {
    if (archive.readUInt32LE(cursor.offset) === END_OF_CENTRAL_DIRECTORY) return cursor.offset;
    cursor.offset -= 1;
  }
  return -1;
};

/**
 * Extract one entry by exact name. Every offset read from the archive is bounds-checked first, so a truncated or
 * crafted download is a typed `ZipError`, never a `RangeError`.
 *
 * @since 0.2.0
 */
export function readZipEntry({
  bytes,
  entry,
}: {
  readonly bytes: Uint8Array;
  readonly entry: string;
}): Result.Result<Uint8Array, ZipError> {
  const archive = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (reason: ZipError["reason"], extra: { method?: number; detail?: string } = {}) =>
    Result.fail(new ZipError({ reason, entry, ...extra }));
  const fits = (offset: number, length: number) => offset >= 0 && offset + length <= archive.length;
  const endRecord = findEndRecord(archive);
  if (endRecord < 0) return fail("not_zip");

  const entryCount = archive.readUInt16LE(endRecord + 10);
  const cursor = { index: 0, offset: archive.readUInt32LE(endRecord + 16) };

  while (cursor.index < entryCount) {
    if (!fits(cursor.offset, CENTRAL_HEADER_SIZE)) return fail("truncated");
    if (archive.readUInt32LE(cursor.offset) !== CENTRAL_HEADER) return fail("not_zip");
    const method = archive.readUInt16LE(cursor.offset + 10);
    const compressedSize = archive.readUInt32LE(cursor.offset + 20);
    const nameLength = archive.readUInt16LE(cursor.offset + 28);
    const extraLength = archive.readUInt16LE(cursor.offset + 30);
    const commentLength = archive.readUInt16LE(cursor.offset + 32);
    const localOffset = archive.readUInt32LE(cursor.offset + 42);
    if (!fits(cursor.offset + CENTRAL_HEADER_SIZE, nameLength)) return fail("truncated");
    const name = archive.toString(
      "utf8",
      cursor.offset + CENTRAL_HEADER_SIZE,
      cursor.offset + CENTRAL_HEADER_SIZE + nameLength,
    );
    cursor.offset += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    cursor.index += 1;

    if (name !== entry) continue;
    if (!fits(localOffset, LOCAL_HEADER_SIZE)) return fail("truncated");
    if (archive.readUInt32LE(localOffset) !== LOCAL_HEADER) return fail("not_zip");
    const dataStart =
      localOffset + LOCAL_HEADER_SIZE + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    if (!fits(dataStart, compressedSize)) return fail("truncated");
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    if (method === STORED) return Result.succeed(data);
    if (method !== DEFLATE) return fail("unsupported_method", { method });
    return Result.try({
      try: (): Uint8Array => inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }),
      catch: (cause) =>
        new ZipError({
          reason: "inflate_failed",
          entry,
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  }

  return fail("entry_missing");
}
