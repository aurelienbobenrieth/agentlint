/**
 * Actor text: who recorded a decision. Audit data only, never identity proof and never part of gate matching.
 *
 * ```text
 * actor     = principal [ "?" details ]
 * principal = everything before the first "?", verbatim: human:<name>, agent:<name>
 * details   = URL query parameters, e.g. session=<thread id>&user=<account>
 * ```
 *
 * Every string parses, so records written before details existed read as a bare principal. Readers keep keys they do
 * not know, so later versions add details without a schema change.
 *
 * @module
 * @since 0.8.0
 */

import { compareStrings } from "./compare.js";

/**
 * A parsed actor.
 */
export interface Actor {
  readonly principal: string;
  readonly details: Readonly<Record<string, string>>;
}

/**
 * How the process actor was chosen. Only an `assumed` actor rests on the absence of agent markers.
 */
export type ActorSource = "declared" | "detected" | "assumed";

/**
 * Parse actor text. Duplicate keys keep the first value; empty keys and values are dropped.
 */
export function parseActor(text: string): Actor {
  const split = text.indexOf("?");
  if (split === -1) return { principal: text, details: {} };
  const details: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text.slice(split + 1)))
    if (key !== "" && value !== "" && !Object.hasOwn(details, key)) details[key] = value;
  return { principal: text.slice(0, split), details };
}

/**
 * Write actor text with details in key order, so the same actor always produces the same bytes. The principal must not
 * contain `?`.
 */
export function formatActor(actor: Actor): string {
  const entries = Object.entries(actor.details)
    .filter(([key, value]) => key !== "" && value !== "")
    .toSorted(([left], [right]) => compareStrings({ left, right }));
  return entries.length === 0 ? actor.principal : `${actor.principal}?${new URLSearchParams(entries).toString()}`;
}

/**
 * Human authority needs a `human:` principal; details never change that.
 */
export function isHumanActor(text: string): boolean {
  return parseActor(text).principal.startsWith("human:");
}

/**
 * Agent runtimes recognised by their environment. Any marker identifies the runtime; `session` names its thread id.
 */
const runtimes: ReadonlyArray<{
  readonly name: string;
  readonly markers: ReadonlyArray<string>;
  readonly session?: string;
}> = [
  {
    name: "codex",
    // CODEX_SANDBOX is unset when Codex runs with full access; the shell markers remain (#74).
    markers: ["CODEX_SANDBOX", "CODEX_ENV_PWD", "CODEX_THREAD_ID", "CODEX_SHELL", "CODEX_CI"],
    session: "CODEX_THREAD_ID",
  },
  { name: "claude", markers: ["CLAUDECODE", "CLAUDE_CODE"], session: "CLAUDE_CODE_SESSION_ID" },
];

/**
 * Choose the process actor: `AGENTLINT_ACTOR` verbatim, else a detected agent runtime with the account it runs for and
 * its session, else the account's human.
 */
export function resolveActor({
  variables,
  username,
}: {
  readonly variables: Readonly<Record<string, string | undefined>>;
  readonly username: () => string;
}): { readonly actor: string; readonly source: ActorSource } {
  const value = (key: string) => variables[key]?.trim() || undefined;
  const declared = value("AGENTLINT_ACTOR");
  if (declared) return { actor: declared, source: "declared" };

  const runtime = runtimes.find((candidate) => candidate.markers.some((marker) => value(marker)));
  const name = runtime?.name ?? value("AI_AGENT")?.replace(/[?\s]+/g, "-");
  if (name === undefined) return { actor: `human:${username()}`, source: "assumed" };

  const session = runtime?.session === undefined ? undefined : value(runtime.session);
  return {
    actor: formatActor({
      principal: `agent:${name}`,
      details: { user: username(), ...(session === undefined ? {} : { session }) },
    }),
    source: "detected",
  };
}
