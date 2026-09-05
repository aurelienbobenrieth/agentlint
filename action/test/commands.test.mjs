// @ts-check
import { describe, expect, it } from "vitest";

import { isSelector, parseCommand } from "../src/commands.mjs";
import { installCommand, resolveCli } from "../src/inputs.mjs";

describe("parseCommand", () => {
  it("ignores bodies that are not commands", () => {
    expect(parseCommand("looks good")).toBeNull();
    expect(parseCommand("/agentlinter approve x")).toBeNull();
    expect(parseCommand("see /agentlint approve")).toBeNull();
  });

  it("parses check", () => {
    expect(parseCommand("/agentlint check")).toEqual({ ok: true, name: "check" });
    expect(parseCommand("/agentlint check now")).toMatchObject({ ok: false });
  });

  it("parses approve with a digest and a quoted reason", () => {
    expect(parseCommand('/agentlint approve 9abade664c94 --reason "Vendored; boundary is upstream"')).toEqual({
      ok: true,
      name: "approve",
      selector: "9abade664c94",
      reason: "Vendored; boundary is upstream",
    });
  });

  it("parses approve with a path:line selector and an unquoted reason", () => {
    expect(parseCommand("/agentlint approve src/a.ts:3 --reason bounded by the TTL window")).toEqual({
      ok: true,
      name: "approve",
      selector: "src/a.ts:3",
      reason: "bounded by the TTL window",
    });
  });

  it("only reads the first line and trims the reason to 1000 characters", () => {
    const long = "x".repeat(1200);
    const parsed = parseCommand(`/agentlint approve 1234567 --reason "${long}"\nsecond line ignored`);
    expect(parsed).toMatchObject({ ok: true, name: "approve", selector: "1234567", reason: "x".repeat(1000) });
  });

  it("rejects missing selectors, bad selectors, and missing reasons", () => {
    expect(parseCommand("/agentlint approve")).toMatchObject({ ok: false });
    expect(parseCommand("/agentlint approve 12345 --reason x")).toMatchObject({ ok: false });
    expect(parseCommand("/agentlint approve 9abade664c94")).toMatchObject({ ok: false });
    expect(parseCommand('/agentlint approve 9abade664c94 --reason ""')).toMatchObject({ ok: false });
    expect(parseCommand("/agentlint approve 9abade664c94 why")).toMatchObject({ ok: false });
    expect(parseCommand("/agentlint deploy")).toMatchObject({ ok: false });
  });

  it("uses the implicit selector for review-comment replies", () => {
    const digest = "9abade664c94c5b47c74e29e92c6a01b848db0a3d51982cd1ac7c26c8d2ebbc1";
    expect(parseCommand("/agentlint approve The allowlist bounds the surface", { implicitSelector: digest })).toEqual({
      ok: true,
      name: "approve",
      selector: digest,
      reason: "The allowlist bounds the surface",
    });
    expect(parseCommand("/agentlint approve", { implicitSelector: digest })).toMatchObject({ ok: false });
  });

  it("keeps shell metacharacters inert: they stay inside a single argument", () => {
    const parsed = parseCommand('/agentlint approve 9abade664c94 --reason "ok; rm -rf / `whoami` $(id) && echo pwned"');
    expect(parsed).toEqual({
      ok: true,
      name: "approve",
      selector: "9abade664c94",
      reason: "ok; rm -rf / `whoami` $(id) && echo pwned",
    });
    expect(isSelector("src/a.ts:3; rm -rf /")).toBe(false);
    expect(isSelector("$(id):3")).toBe(false);
    expect(isSelector("`x`:3")).toBe(false);
    expect(parseCommand("/agentlint approve ../../etc/passwd:1 --reason x")).toMatchObject({
      ok: true,
      selector: "../../etc/passwd:1",
    });
  });
});

describe("resolveCli", () => {
  it("maps semver to npx and file: to a built checkout", () => {
    const [npx, yes, spec] = resolveCli("0.1.5", "/ws");
    expect(npx?.startsWith("npx")).toBe(true);
    expect(yes).toBe("--yes");
    expect(spec).toBe("@aurelienbbn/agentlint@0.1.5");
    expect(resolveCli("file:packages/agentlint", "/ws")[1]?.replace(/\\/g, "/")).toMatch(
      /\/ws\/packages\/agentlint\/dist\/bin\.mjs$/,
    );
    expect(resolveCli("1.0.0-rc.1", "/ws")[2]).toBe("@aurelienbbn/agentlint@1.0.0-rc.1");
  });

  it("rejects anything else", () => {
    expect(() => resolveCli("latest", "/ws")).toThrow(/semver/);
    expect(() => resolveCli("0.1.5; rm -rf /", "/ws")).toThrow(/semver/);
    expect(() => resolveCli("file:", "/ws")).toThrow(/path/);
  });
});

describe("installCommand", () => {
  it("detects the package manager from the lockfile", () => {
    expect(installCommand(["pnpm-lock.yaml", "package.json"])).toEqual(["pnpm", "install", "--frozen-lockfile"]);
    expect(installCommand(["bun.lock"])).toEqual(["bun", "install", "--frozen-lockfile"]);
    expect(installCommand(["yarn.lock"])).toEqual(["yarn", "install", "--immutable"]);
    expect(installCommand(["package-lock.json"])).toEqual(["npm", "ci"]);
    expect(installCommand(["package.json"])).toBeNull();
  });
});
