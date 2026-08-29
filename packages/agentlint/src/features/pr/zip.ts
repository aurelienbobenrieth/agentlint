/**
 * Minimal ZIP reader for GitHub Actions artifacts.
 *
 * Walks the central directory, so entries written with data descriptors
 * (sizes absent from the local header) still resolve. Supports the stored
 * and deflate methods, which is all the artifact service produces.
 *
 * @module
 * @since 0.2.0
 */

import { inflateRawSync } from "node:zlib";
import { Schema } from "effect";

/** @since 0.2.0 @category errors */
export class ZipError extends Schema.TaggedError<ZipError>()("agentlint/ZipError", {
  reason: Schema.Literals(["not_zip", "entry_missing", "unsupported_method"]),
  entry: Schema.String,
  method: Schema.optional(Schema.Number),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not_zip":
        return "The downloaded file is not a ZIP archive";
      case "entry_missing":
        return `The archive has no ${this.entry} entry`;
      case "unsupported_method":
        return `${this.entry} uses unsupported compression method ${this.method}`;
    }
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

const findEndRecord = (archive: Buffer): number => {
  for (let offset = archive.length - END_RECORD_SIZE; offset >= 0; offset--) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
};

/**
 * Extract one entry by exact name.
 *
 * @throws ZipError when the buffer is not a ZIP archive, the entry is absent, or its method is unsupported.
 * @since 0.2.0
 */
export function readZipEntry(bytes: Uint8Array, entry: string): Uint8Array {
  const archive = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endRecord = findEndRecord(archive);
  if (endRecord < 0) throw new ZipError({ reason: "not_zip", entry });

  const entryCount = archive.readUInt16LE(endRecord + 10);
  let offset = archive.readUInt32LE(endRecord + 16);

  for (let index = 0; index < entryCount; index++) {
    if (offset + CENTRAL_HEADER_SIZE > archive.length || archive.readUInt32LE(offset) !== CENTRAL_HEADER) {
      throw new ZipError({ reason: "not_zip", entry });
    }
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString("utf8", offset + CENTRAL_HEADER_SIZE, offset + CENTRAL_HEADER_SIZE + nameLength);
    offset += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;

    if (name !== entry) continue;
    if (archive.readUInt32LE(localOffset) !== LOCAL_HEADER) throw new ZipError({ reason: "not_zip", entry });
    const dataStart =
      localOffset + LOCAL_HEADER_SIZE + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    if (method === STORED) return data;
    if (method === DEFLATE) return inflateRawSync(data);
    throw new ZipError({ reason: "unsupported_method", entry, method });
  }

  throw new ZipError({ reason: "entry_missing", entry });
}
