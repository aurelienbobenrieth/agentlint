/** Tiny ZIP writer for tests: local headers, central directory, end record. */

import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
  readonly method: "stored" | "deflate";
}

const u16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};
const u32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

export function writeZip(entries: ReadonlyArray<ZipEntry>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method === "deflate" ? 8 : 0;
    const payload = entry.method === "deflate" ? deflateRawSync(entry.data) : Buffer.from(entry.data);
    const crc = crc32(entry.data);
    const common = Buffer.concat([
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
    ]);
    const local = Buffer.concat([u32(0x04034b50), common, name, payload]);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    locals.push(local);
    offset += local.length;
  }

  const central = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, central, end]);
}
