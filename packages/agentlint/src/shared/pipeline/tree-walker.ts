/**
 * Single-pass multi-rule tree walker.
 *
 * Builds a dispatch table from all active rules' visitor methods,
 * walks the tree once using tree-sitter's cursor API, and calls
 * all matching handlers per node.
 *
 * @module
 */

import type { Tree, TreeCursor } from "web-tree-sitter";
import { type AgentlintNode, wrapNode } from "../../domain/node.js";
import type { FindingRecord } from "../../domain/finding.js";
import type { VisitorHandler, Visitors } from "../../domain/rule.js";
import type { RuleContextImpl } from "../../domain/rule-context.js";

/**
 * Internal binding of a rule to its context and visitors for a walk pass.
 *
 * @since 0.1.0
 * @category models
 */
interface RuleEntry {
  readonly ruleId: string;
  readonly context: RuleContextImpl;
  readonly visitors: Visitors;
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
export function visitorKeys(visitors: Visitors): ReadonlyArray<string> {
  const handlers = visitors as Readonly<Record<string, unknown>>;
  return Object.keys(handlers).filter(
    (key) => key !== "before" && key !== "after" && typeof handlers[key] === "function",
  );
}

export function walkFile(tree: Tree, rules: ReadonlyArray<RuleEntry>): ReadonlyArray<FindingRecord> {
  const dispatchTable = new Map<string, VisitorHandler[]>();
  for (const entry of rules) {
    for (const key of visitorKeys(entry.visitors)) {
      const handler = (entry.visitors as Readonly<Record<string, unknown>>)[key] as VisitorHandler;
      const existing = dispatchTable.get(key);
      if (existing) {
        existing.push(handler);
      } else {
        dispatchTable.set(key, [handler]);
      }
    }
  }

  const cursor: TreeCursor = tree.walk();
  let reachedEnd = false;

  while (!reachedEnd) {
    const handlers = dispatchTable.get(cursor.nodeType);
    if (handlers) {
      const wrapped: AgentlintNode = wrapNode(cursor.currentNode);
      for (const handler of handlers) {
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

  const allFindings: FindingRecord[] = [];
  for (const entry of rules) {
    allFindings.push(...entry.context.drainFindings());
  }

  return allFindings;
}
