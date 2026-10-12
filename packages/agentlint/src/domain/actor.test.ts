import { describe, expect, it } from "vitest";
import { formatActor, isHumanActor, parseActor, resolveActor } from "./actor.js";

describe("actor text", () => {
  it("reads every legacy actor as a bare principal", () => {
    for (const text of ["human:aurel", "agent:codex", "agent:claude", "human:local-review", "ci-bot", "a@b.c#1", ""])
      expect(parseActor(text)).toEqual({ principal: text, details: {} });
  });

  it("splits details at the first question mark and decodes them", () => {
    expect(parseActor("agent:claude?session=7f3c&user=aurel%40quasar.work")).toEqual({
      principal: "agent:claude",
      details: { session: "7f3c", user: "aurel@quasar.work" },
    });
    expect(parseActor("agent:x?note=a%3Fb%26c=d")).toEqual({ principal: "agent:x", details: { note: "a?b&c=d" } });
  });

  it("never fails: duplicates keep the first value, empty keys and values are dropped", () => {
    expect(parseActor("agent:x?session=1&session=2&=v&empty=&flag")).toEqual({
      principal: "agent:x",
      details: { session: "1" },
    });
    expect(parseActor("agent:x?%E0%A4%A")).toEqual({ principal: "agent:x", details: {} });
  });

  it("keeps keys it does not know, so later versions can add details", () => {
    expect(parseActor("agent:x?zz-future=1").details).toEqual({ "zz-future": "1" });
  });

  it("writes details in key order, and nothing after a principal without details", () => {
    expect(formatActor({ principal: "agent:codex", details: { user: "aurel", session: "019a" } })).toBe(
      "agent:codex?session=019a&user=aurel",
    );
    expect(formatActor({ principal: "human:aurel", details: {} })).toBe("human:aurel");
  });

  it("round-trips details holding every delimiter the grammar uses", () => {
    // Deterministic generator: the same strings on every run.
    const alphabet = ["a", "Z", "0", "?", "&", "=", "%", "+", " ", "#", "@", ":", "é", "/", "\\"];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const text = () => Array.from({ length: 1 + (next() % 8) }, () => alphabet[next() % alphabet.length]).join("");
    for (let run = 0; run < 500; run++) {
      const details = Object.fromEntries(Array.from({ length: next() % 4 }, () => [text(), text()]));
      const actor = { principal: `agent:${text().replace(/\?/g, "")}`, details };
      expect(parseActor(formatActor(actor))).toEqual(actor);
    }
  });

  it("calls an actor human only by its principal", () => {
    expect(isHumanActor("human:aurel")).toBe(true);
    expect(isHumanActor("human:aurel?session=1")).toBe(true);
    expect(isHumanActor("agent:claude?user=human:aurel")).toBe(false);
    expect(isHumanActor("humane")).toBe(false);
  });
});

const resolve = (variables: Record<string, string>) => resolveActor({ variables, username: () => "aurel" });

describe("resolveActor", () => {
  it("takes a declared actor verbatim, details included", () => {
    expect(resolve({ AGENTLINT_ACTOR: " agent:cursor?session=c1 ", CLAUDECODE: "1" })).toEqual({
      actor: "agent:cursor?session=c1",
      source: "declared",
    });
    expect(resolve({ AGENTLINT_ACTOR: "human:reviewer" })).toEqual({ actor: "human:reviewer", source: "declared" });
  });

  it("treats a blank declaration as unset", () => {
    expect(resolve({ AGENTLINT_ACTOR: "  " })).toEqual({ actor: "human:aurel", source: "assumed" });
  });

  it("detects Codex from any of its markers, including a full-access session (#74)", () => {
    for (const marker of ["CODEX_SANDBOX", "CODEX_ENV_PWD", "CODEX_CI", "CODEX_SHELL"])
      expect(resolve({ [marker]: "1" })).toEqual({ actor: "agent:codex?user=aurel", source: "detected" });
    expect(resolve({ CODEX_CI: "1", CODEX_SHELL: "1", CODEX_THREAD_ID: "019a-thread" })).toEqual({
      actor: "agent:codex?session=019a-thread&user=aurel",
      source: "detected",
    });
  });

  it("detects Claude Code and records its session", () => {
    expect(resolve({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "7f3c" })).toEqual({
      actor: "agent:claude?session=7f3c&user=aurel",
      source: "detected",
    });
    expect(resolve({ CLAUDE_CODE: "1" })).toEqual({ actor: "agent:claude?user=aurel", source: "detected" });
  });

  it("falls back to the AI_AGENT convention for runtimes it does not know", () => {
    expect(resolve({ AI_AGENT: " some-agent " })).toEqual({ actor: "agent:some-agent?user=aurel", source: "detected" });
    expect(resolve({ AI_AGENT: "odd?name" }).actor).toBe("agent:odd-name?user=aurel");
  });

  it("prefers a named runtime over AI_AGENT", () => {
    expect(resolve({ AI_AGENT: "claude-code_2_agent", CLAUDECODE: "1" }).actor).toBe("agent:claude?user=aurel");
  });

  it("assumes the account's human when nothing names an agent", () => {
    expect(resolve({ CODEX_SANDBOX: "", AI_AGENT: " " })).toEqual({ actor: "human:aurel", source: "assumed" });
  });
});
