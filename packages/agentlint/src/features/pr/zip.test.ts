import { describe, expect, it } from "vitest";
import { writeZip } from "../../__fixtures__/zip.js";
import { readZipEntry } from "./zip.js";

const text = (value: string) => Buffer.from(value, "utf8");

describe("readZipEntry", () => {
  it("reads stored and deflated entries by name", () => {
    const big = text("agentlint ".repeat(2_000));
    const archive = writeZip([
      { name: "stored.txt", data: text("plain"), method: "stored" },
      { name: "nested/agentlint-review.json", data: big, method: "deflate" },
    ]);

    expect(Buffer.from(readZipEntry(archive, "stored.txt")).toString("utf8")).toBe("plain");
    expect(Buffer.from(readZipEntry(archive, "nested/agentlint-review.json")).equals(big)).toBe(true);
  });

  it("reports a missing entry and a non-archive", () => {
    const archive = writeZip([{ name: "a.txt", data: text("a"), method: "stored" }]);
    expect(() => readZipEntry(archive, "b.txt")).toThrow(expect.objectContaining({ reason: "entry_missing" }));
    expect(() => readZipEntry(text("not a zip at all"), "b.txt")).toThrow(
      expect.objectContaining({ reason: "not_zip" }),
    );
  });
});
