/**
 * Single-pass multi-rule tree walker.
 *
 * Builds a dispatch table from all active rules' visitor methods,
 * walks the tree once using tree-sitter's cursor API, and calls
 * all matching handlers per node.
 *
 * @module
 */

import { Effect, HashMap, Option } from "effect";
import type { Tree, TreeCursor } from "web-tree-sitter";
import { type AgentReviewNode, wrapNode } from "../../domain/node.js";
import type { FlagRecord } from "../../domain/flag.js";
import type { VisitorHandler, Visitors } from "../../domain/rule.js";
import type { RuleContextImpl } from "../../domain/rule-context.js";

/**
 * Internal binding of a rule to its context and visitors for a walk pass.
 *
 * @since 0.1.0
 * @category models
 */
interface RuleEntry {
  readonly ruleName: string;
  readonly context: RuleContextImpl;
  readonly visitors: Visitors;
}

/**
 * A single handler entry in the dispatch table, keyed by node type.
 *
 * @since 0.1.0
 * @category models
 */
interface DispatchHandler {
  readonly ruleName: string;
  readonly handler: VisitorHandler;
}

/**
 * Walk files with the given rules, collecting all flags.
 *
 * Call this once per file. The caller is responsible for:
 * - Calling `context.setFile()` before this function
 * - Calling `before()` and filtering out skipped rules
 * - Calling `after()` after all files are processed
 *
 * @internal
 */
export function walkFile(tree: Tree, rules: ReadonlyArray<RuleEntry>): ReadonlyArray<FlagRecord> {
  const dispatchTable: HashMap.HashMap<string, DispatchHandler[]> = HashMap.mutate(
    HashMap.empty<string, DispatchHandler[]>(),
    (m) => {
      for (const entry of rules) {
        for (const key of Object.keys(entry.visitors)) {
          if (key === "before" || key === "after") continue;
          const handler = entry.visitors[key];
          if (typeof handler !== "function") continue;

          const existing = Option.getOrUndefined(HashMap.get(m, key));
          if (existing) {
            existing.push({ ruleName: entry.ruleName, handler: handler as VisitorHandler });
          } else {
            HashMap.set(m, key, [{ ruleName: entry.ruleName, handler: handler as VisitorHandler }]);
          }
        }
      }
    },
  );

  const cursor: TreeCursor = tree.walk();
  let reachedEnd = false;

  while (!reachedEnd) {
    const nodeType = cursor.nodeType;

    const handlers = Option.getOrUndefined(HashMap.get(dispatchTable, nodeType));
    if (handlers) {
      const wrapped: AgentReviewNode = wrapNode(cursor.currentNode);
      for (const { handler } of handlers) {
        handler(wrapped);
      }
    }

    if (cursor.gotoFirstChild()) continue;
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) {
        reachedEnd = true;
        break;
      }
    }
  }

  const allFlags: FlagRecord[] = [];
  for (const entry of rules) {
    allFlags.push(...entry.context.drainFlags());
  }

  return allFlags;
}

/**
 * Effect wrapper around {@link walkFile}.
 *
 * Runs the tree walk synchronously inside `Effect.sync`, making it
 * composable with the rest of the Effect pipeline.
 *
 * @since 0.1.0
 * @category constructors
 */
export function walkFileEffect(tree: Tree, rules: ReadonlyArray<RuleEntry>): Effect.Effect<ReadonlyArray<FlagRecord>> {
  return Effect.sync(() => walkFile(tree, rules));
}
