import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { Env } from "./env.js";

const keys = [
  "AGENTLINT_ACTOR",
  "CODEX_SANDBOX",
  "CODEX_ENV_PWD",
  "CODEX_THREAD_ID",
  "CODEX_SHELL",
  "CODEX_CI",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CLAUDE_CODE_SESSION_ID",
  "AI_AGENT",
  "USER",
  "USERNAME",
];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

const resolved = () =>
  Effect.runSync(Effect.map(Env, ({ actor, actorSource }) => ({ actor, actorSource })).pipe(Effect.provide(Env.layer)));
const actor = () => resolved().actor;

describe("Env actor", () => {
  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("treats a blank override as unset, so persisted actors are never empty", () => {
    for (const key of keys) delete process.env[key];
    process.env["AGENTLINT_ACTOR"] = "  ";
    process.env["USER"] = "reviewer";
    expect(actor()).toBe("human:reviewer");
  });

  it("uses a set override without consulting the account", () => {
    for (const key of keys) delete process.env[key];
    process.env["AGENTLINT_ACTOR"] = "agent:ci";
    expect(actor()).toBe("agent:ci");
  });

  it("records a full-access Codex session as an agent with its thread (#74)", () => {
    for (const key of keys) delete process.env[key];
    process.env["CODEX_SHELL"] = "1";
    process.env["CODEX_THREAD_ID"] = "019a-thread";
    process.env["USER"] = "reviewer";
    expect(resolved()).toEqual({ actor: "agent:codex?session=019a-thread&user=reviewer", actorSource: "detected" });
  });
});
