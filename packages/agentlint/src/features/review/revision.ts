/**
 * When a review may reuse its last scan. @module
 */

import { createHash } from "node:crypto";
import { Effect, FileSystem, Option, Path } from "effect";
import { Env } from "../../config/env.js";
import type { AgentlintRule } from "../../domain/rule/model.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git/service.js";
import { selectBase } from "../../shared/pipeline/base.js";
import { filterRules, scopeMatcher } from "../../shared/pipeline/finding/rules.js";

/**
 * Files a rule reads by name, whatever its scope.
 */
const declaredDependencies = (rule: AgentlintRule): ReadonlyArray<string> =>
  rule.lifecycle === "state" ? (rule.binding.dependencies ?? []) : [];

/**
 * A digest of everything a scan of `rules` reads: the compared commits, the listed files some rule can see, and each
 * such file's size and modification time. Equal digests mean the scan would produce the same findings, so its result
 * can be reused. A file no rule can see (the acceptance store, usually) never changes the digest, so recording a
 * decision does not force a new scan. `undefined` when the repository cannot be described this way; then every request
 * scans.
 */
export const scanRevision = Effect.fn("scanRevision")(function* ({
  rules,
  base,
}: {
  readonly rules: ReadonlyArray<string>;
  readonly base: string | undefined;
}) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* Git;
  const config = yield* (yield* ConfigLoader).load();
  if (!git.listFiles || !git.revision) return undefined;
  const listed = yield* git.listFiles();
  if (listed === undefined) return undefined;
  const active = filterRules({ config, requested: rules });
  const scopes = active.map((rule) => scopeMatcher(rule));
  const dependencies = new Set(active.flatMap((rule) => declaredDependencies(rule)));
  const visible = [...new Set([...listed.filter((file) => scopes.some((inScope) => inScope(file))), ...dependencies])];
  const hash = createHash("sha256").update(yield* git.revision((yield* selectBase(base))?.ref));
  const stats = yield* Effect.forEach(
    visible.toSorted(),
    (file) =>
      fs.stat(path.resolve(env.cwd, file)).pipe(
        Effect.map((info) => `${file}\0${Option.getOrUndefined(info.mtime)?.getTime() ?? ""}\0${info.size}`),
        Effect.orElseSucceed(() => `${file}\0missing`),
      ),
    { concurrency: 16 },
  );
  for (const entry of stats) hash.update(`\0${entry}`);
  return hash.digest("hex");
});
