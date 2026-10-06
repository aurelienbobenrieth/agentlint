/**
 * Which ref a change compares against. @module
 */

import { Effect } from "effect";
import { Env } from "../../config/env.js";
import { ConfigLoader } from "../infrastructure/config-loader.js";
import { Git } from "../infrastructure/git/service.js";

/**
 * A named base and what named it. Without one, Git's default branch is the base (`default`).
 */
interface SelectedBase {
  readonly ref: string;
  readonly source: "--base" | "AGENTLINT_BASE" | "config" | "upstream";
}

/**
 * `--base`, else `AGENTLINT_BASE`, else the config's `base`, else the branch HEAD tracks. `undefined` leaves the base
 * to Git's default branch.
 */
export const selectBase = Effect.fn("selectBase")(function* (requested: string | undefined) {
  if (requested !== undefined) return { ref: requested, source: "--base" } satisfies SelectedBase;
  const { base: variable } = yield* Env;
  if (variable !== undefined) return { ref: variable, source: "AGENTLINT_BASE" } satisfies SelectedBase;
  const { base: configured } = yield* (yield* ConfigLoader).load();
  if (configured !== undefined) return { ref: configured, source: "config" } satisfies SelectedBase;
  const tracked = yield* (yield* Git).trackedBase();
  return tracked === undefined ? undefined : ({ ref: tracked, source: "upstream" } satisfies SelectedBase);
});
