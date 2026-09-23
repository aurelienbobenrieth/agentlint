import { describe, expect, it } from "vitest";
import { writeZip } from "../../__fixtures__/zip.js";
import { Result } from "effect";
import { readZipEntry } from "./zip.js";

const text = (value: string) => Buffer.from(value, "utf8");

describe("readZipEntry", () => {
  it("reads stored and deflated entries by name", () => {
    const big = text("agentlint ".repeat(2_000));
    const archive = writeZip([
      { name: "stored.txt", data: text("plain"), method: "stored" },
      { name: "nested/agentlint-review.json", data: big, method: "deflate" },
    ]);

    const read = (entry: string) => Buffer.from(Result.getOrThrow(readZipEntry({ bytes: archive, entry })));
    expect(read("stored.txt").toString("utf8")).toBe("plain");
    expect(read("nested/agentlint-review.json").equals(big)).toBe(true);
  });

  it("reports a missing entry and a non-archive", () => {
    const archive = writeZip([{ name: "a.txt", data: text("a"), method: "stored" }]);
    expect(readZipEntry({ bytes: archive, entry: "b.txt" })).toMatchObject({ failure: { reason: "entry_missing" } });
    expect(readZipEntry({ bytes: text("not a zip at all"), entry: "b.txt" })).toMatchObject({
      failure: { reason: "not_zip" },
    });
  });

  it("reports a truncated or crafted archive as a typed failure", () => {
    const archive = writeZip([{ name: "a.txt", data: text("hello"), method: "stored" }]);
    // Point the entry's local header offset past the end of the buffer.
    const crafted = Buffer.from(archive);
    const central = crafted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    crafted.writeUInt32LE(crafted.length + 100, central + 42);
    expect(readZipEntry({ bytes: crafted, entry: "a.txt" })).toMatchObject({ failure: { reason: "truncated" } });
    // Corrupt deflate data inflates to an error, not an exception.
    const deflated = Buffer.from(writeZip([{ name: "a.txt", data: text("hello ".repeat(50)), method: "deflate" }]));
    const local = deflated.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    deflated.fill(0xff, local + 30 + "a.txt".length, local + 30 + "a.txt".length + 4);
    expect(readZipEntry({ bytes: deflated, entry: "a.txt" })).toMatchObject({ failure: { reason: "inflate_failed" } });
  });
});
