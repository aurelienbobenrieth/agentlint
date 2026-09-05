import { describe, expect, it } from "vitest";
import {
  bindingDigest,
  canonicalDigest,
  canonicalStringify,
  fingerprintChange,
  fingerprintState,
  normalizeRepositoryPath,
} from "./fingerprint.js";

describe("canonical fingerprints", () => {
  it("ignores object key order and preserves distinct Unicode", () => {
    expect(canonicalDigest({ b: 2, a: "e\u0301" })).not.toBe(canonicalDigest({ a: "é", b: 2 }));
    expect(canonicalStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("rejects values outside canonical JSON", () => {
    expect(() => canonicalStringify({ value: Number.NaN })).toThrow("numbers must be finite");
    expect(() => canonicalStringify({ value: undefined } as never)).toThrow("not canonical JSON data");
  });

  it("normalizes equivalent repository paths", () => {
    expect(normalizeRepositoryPath("./src\\domain/../index.ts")).toBe("src/index.ts");
    expect(() => normalizeRepositoryPath("../outside.ts")).toThrow("escapes the repository");
    expect(() => normalizeRepositoryPath("C:/repo/file.ts")).toThrow("repository-relative");
  });

  it("keeps state fingerprints through formatting and line movement", () => {
    const first = fingerprintState({
      path: "src/query.ts",
      structure: { call: "findMany", arguments: [{ limit: 10 }] },
      occurrence: "function:listUsers/call:0",
    });
    const formattedAndMoved = fingerprintState({
      path: "./src\\query.ts",
      structure: { arguments: [{ limit: 10 }], call: "findMany" },
      occurrence: "function:listUsers/call:0",
    });

    expect(first).toEqual(formattedAndMoved);
  });

  it("invalidates state fingerprints for paths, captures, and duplicate occurrences", () => {
    const base = {
      path: "src/query.ts",
      structure: { call: "findMany" },
      captures: { table: "users" },
      occurrence: "function:listUsers/call:0",
    } as const;
    const fingerprint = fingerprintState(base);

    expect(fingerprintState({ ...base, path: "src/moved.ts" }).digest).not.toBe(fingerprint.digest);
    expect(fingerprintState({ ...base, captures: { table: "accounts" } }).digest).not.toBe(fingerprint.digest);
    expect(fingerprintState({ ...base, occurrence: "function:listUsers/call:1" }).digest).not.toBe(fingerprint.digest);
  });

  it("identifies equal change evidence independently of a Git rebase", () => {
    const evidence = {
      before: { columns: ["id", "name"] },
      after: { columns: ["id"] },
      beforePath: "migrations/users.sql",
      afterPath: "migrations/users.sql",
      operation: "modify" as const,
      occurrence: "table:users/column:name",
    };
    expect(fingerprintChange(evidence)).toEqual(fingerprintChange({ ...evidence }));
    expect(fingerprintChange({ ...evidence, operation: "rename" }).digest).not.toBe(fingerprintChange(evidence).digest);
  });

  it("normalizes binding object and routing-set order", () => {
    const left = bindingDigest({
      include: ["src/**/*.ts", "packages/**/*.ts"],
      options: { client: "prisma", operations: ["read", "write"] },
    });
    const right = bindingDigest({
      options: { operations: ["read", "write"], client: "prisma" },
      include: ["packages/**/*.ts", "src/**/*.ts"],
    });
    expect(left).toBe(right);
    expect(bindingDigest({ options: { operations: ["write", "read"], client: "prisma" } })).not.toBe(
      bindingDigest({ options: { operations: ["read", "write"], client: "prisma" } }),
    );
  });
});
