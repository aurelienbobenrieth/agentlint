/**
 * Terminal reporter — formats flag results into human-readable output.
 *
 * Respects `NO_COLOR` and non-TTY environments. Groups flags by rule,
 * then by file, and appends instruction/hint blocks when available.
 *
 * @module
 * @since 0.1.0
 */

import { Effect, HashMap, Option, Path, Schema } from "effect";
import { Env } from "../config/env.js";
import type { FlagRecord } from "../domain/flag.js";
import type { RuleMeta } from "../domain/rule.js";

/**
 * Group an array by a key function, returning a HashMap of arrays.
 *
 * @since 0.1.0
 * @category internals
 */
function groupBy<A>(items: ReadonlyArray<A>, key: (a: A) => string): HashMap.HashMap<string, A[]> {
  return items.reduce((acc, item) => {
    const k = key(item);
    const existing = Option.getOrUndefined(HashMap.get(acc, k));
    return existing ? (existing.push(item), acc) : HashMap.set(acc, k, [item]);
  }, HashMap.empty<string, A[]>());
}

/**
 * Build the minimal ANSI escape helpers. Each function is a no-op when
 * `noColor` is `true`.
 *
 * @since 0.1.0
 * @category internals
 */
function makeAnsi(noColor: boolean) {
  return {
    bold: (s: string) => (noColor ? s : `\x1b[1m${s}\x1b[22m`),
    dim: (s: string) => (noColor ? s : `\x1b[2m${s}\x1b[22m`),
    yellow: (s: string) => (noColor ? s : `\x1b[33m${s}\x1b[39m`),
    cyan: (s: string) => (noColor ? s : `\x1b[36m${s}\x1b[39m`),
    magenta: (s: string) => (noColor ? s : `\x1b[35m${s}\x1b[39m`),
    gray: (s: string) => (noColor ? s : `\x1b[90m${s}\x1b[39m`),
    underline: (s: string) => (noColor ? s : `\x1b[4m${s}\x1b[24m`),
    reset: noColor ? "" : "\x1b[0m",
  };
}

/**
 * Options that control the reporter's output format.
 *
 * @since 0.1.0
 * @category models
 */
export const ReporterOptions = Schema.Struct({
  /** When `true`, instruction and hint blocks are suppressed. */
  dryRun: Schema.Boolean,
  /** Version string displayed in the header line. */
  version: Schema.String,
});

/** @since 0.1.0 */
export type ReporterOptions = Schema.Schema.Type<typeof ReporterOptions>;

/**
 * Format flag results into a terminal-friendly report string.
 *
 * Groups flags by rule name, then by file path. Includes source
 * snippets, per-match instructions/hints, and a summary line.
 * Returns a single "no rules triggered" line when the flag list
 * is empty.
 *
 * Uses the `Env` service for colour/cwd detection and the Effect
 * `Path` service for cross-platform path resolution.
 *
 * @since 0.1.0
 * @category constructors
 */
export const formatReport = Effect.fn("formatReport")(function* (
  flags: ReadonlyArray<FlagRecord>,
  rulesMeta: HashMap.HashMap<string, RuleMeta>,
  options: ReporterOptions,
) {
  const env = yield* Env;
  const path = yield* Path.Path;
  const ansi = makeAnsi(env.noColor);

  if (flags.length === 0) {
    return `${ansi.bold("agentlint")} ${ansi.dim(`v${options.version}`)} ${ansi.dim("-")} no rules triggered.`;
  }

  const { cwd } = env;
  const lines: string[] = [];

  const grouped = groupBy(flags, (f) => f.ruleName);

  const groupedSize = HashMap.size(grouped);

  if (flags.length > 50) {
    lines.push(
      ansi.yellow("⚠") +
        ` ${flags.length} matches across ${groupedSize} rules. ` +
        ansi.dim("Consider narrowing scope with --rule or targeting specific files."),
    );
    lines.push("");
  }

  for (const [ruleName, ruleFlags] of grouped) {
    const meta = Option.getOrUndefined(HashMap.get(rulesMeta, ruleName));

    lines.push(ansi.yellow(`  x ${ruleName}`) + ansi.dim(meta ? `: ${meta.description}` : ""));
    lines.push("");

    const byFile = groupBy(ruleFlags, (f) => path.relative(cwd, f.filename).replace(/\\/g, "/"));

    for (const [_filePath, fileFlags] of byFile) {
      for (const flag of fileFlags) {
        const relPath = path.relative(cwd, flag.filename).replace(/\\/g, "/");
        const loc = `${relPath}:${flag.line}:${flag.col}`;
        const snippet = flag.sourceSnippet.length > 80 ? flag.sourceSnippet.slice(0, 77) + "..." : flag.sourceSnippet;

        lines.push(`    ${ansi.cyan(loc)} ${ansi.dim(`[${flag.hash}]`)}  ${flag.message}`);
        if (snippet && snippet !== flag.message) {
          lines.push(`      ${ansi.dim(snippet)}`);
        }
        lines.push("");
      }
    }

    if (!options.dryRun && meta?.instruction) {
      lines.push(ansi.dim("    ┌─ Instruction ─────────────────────────────────"));
      for (const instrLine of meta.instruction.split("\n")) {
        lines.push(ansi.dim(`    │ ${instrLine}`));
      }
      lines.push(ansi.dim("    └───────────────────────────────────────────────"));
      lines.push("");
    }

    const matchNotes = ruleFlags.filter((f) => f.instruction || f.suggest);
    if (!options.dryRun && matchNotes.length > 0) {
      for (const flag of matchNotes) {
        const relPath = path.relative(cwd, flag.filename).replace(/\\/g, "/");
        if (flag.instruction) {
          lines.push(`    ${ansi.magenta("note")} ${ansi.dim(`${relPath}:${flag.line}`)} ${flag.instruction}`);
        }
        if (flag.suggest) {
          lines.push(`    ${ansi.magenta("hint")} ${ansi.dim(`${relPath}:${flag.line}`)} ${flag.suggest}`);
        }
      }
      lines.push("");
    }
  }

  const ruleWord = groupedSize === 1 ? "rule" : "rules";
  const matchWord = flags.length === 1 ? "match" : "matches";
  lines.push(ansi.bold(ansi.yellow(`Found ${flags.length} ${matchWord}`)) + ansi.dim(` (${groupedSize} ${ruleWord})`));

  return lines.join("\n");
});
