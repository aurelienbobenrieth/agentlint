import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { Env } from "./env.js";

const keys = ["AGENTLINT_ACTOR", "CODEX_SANDBOX", "CODEX_ENV_PWD", "CLAUDECODE", "CLAUDE_CODE", "USER", "USERNAME"];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

const actor = () => Effect.runSync(Effect.map(Env, (env) => env.actor).pipe(Effect.provide(Env.layer)));

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
});
