/**
 * One deterministic next obligation; the complete gate still belongs to check. @module @since 0.2.0
 */
import { Effect } from "effect";
import { checkHandler } from "../check/handler.js";
import { CheckCommand, CheckResult } from "../check/request.js";
import { findingKey } from "../../domain/finding.js";
import { buildReviewPayload } from "../review/handler.js";
import { NextCommand, type NextResult } from "./request.js";

export const nextHandler = Effect.fn("nextHandler")(function* (command: NextCommand) {
  const check = yield* checkHandler(
    new CheckCommand({ all: true, rules: command.rules, base: command.base, files: [] }),
    false,
  );
  const first = check.unresolved.toSorted((left, right) => {
    const fileOrder = left.file < right.file ? -1 : left.file > right.file ? 1 : 0;
    if (fileOrder !== 0) return fileOrder;
    if (left.line !== right.line) return left.line - right.line;
    const a = findingKey(left);
    const b = findingKey(right);
    return a < b ? -1 : a > b ? 1 : 0;
  })[0];
  const payload =
    first === undefined
      ? undefined
      : yield* buildReviewPayload({
          check: new CheckResult({ ...check, findings: [first] }),
          base: command.base,
          mode: "review",
          transport: "detached",
        });
  const finding = payload?.findings.find(({ id }) => first !== undefined && id === findingKey(first)) ?? null;
  const baseArgs = check.base === undefined ? [] : ["--base", check.base];
  const checkpoint = {
    purpose: "Verify the complete gate",
    argv: ["check", "--all", ...baseArgs],
    requiredInput: null,
  };
  return {
    version: 1,
    status: check.noMatchingRules ? "no_matching_rules" : finding === null ? "clear" : "unresolved",
    scope: check.scope,
    base: check.base ?? null,
    remaining: check.unresolved.length,
    selector: first?.selector ?? null,
    executedBindings: check.availableRules,
    finding,
    source: finding === null ? null : (check.sources[finding.file] ?? null),
    excerpt: first?.sourceSnippet ?? null,
    actions:
      finding === null
        ? [checkpoint]
        : [
            ...(finding.authority === "agent"
              ? [
                  {
                    purpose: "Record a justified agent decision",
                    argv: ["accept", finding.id, ...baseArgs],
                    requiredInput: "--reason <justification>",
                  },
                ]
              : [
                  {
                    purpose: "Attach work for the human reviewer",
                    argv: ["propose", finding.id, ...baseArgs],
                    requiredInput: "--summary <work performed> [--diff-file <path>]",
                  },
                  { purpose: "Open human review", argv: ["review", ...baseArgs], requiredInput: null },
                ]),
            {
              purpose: "Continue with the next obligation",
              argv: ["next", ...baseArgs, ...command.rules.flatMap((rule) => ["--rule", rule])],
              requiredInput: null,
            },
            checkpoint,
          ],
    exitCode: check.noMatchingRules ? 2 : finding === null ? 0 : 1,
  } satisfies NextResult;
});
