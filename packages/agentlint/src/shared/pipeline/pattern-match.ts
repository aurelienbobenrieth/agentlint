import { PatternError } from "../../domain/pattern-error.js";
/**
 * Declarative rule matching.
 *
 * Compiles `RuleMatch` definitions into executable matchers:
 *
 * - `pattern` is code-shaped ("pattern by example"): the pattern source is
 *   parsed with the same grammar as the target file and compared
 *   structurally. `$NAME` captures one node, `$_` matches one node without
 *   capturing, `$$$NAME` matches zero or more trailing siblings.
 * - `query` is a raw tree-sitter query, for cases where grammar-level
 *   precision is needed.
 *
 * Rule authors write code shapes, not visitor plumbing — the pattern is
 * validated against the real grammar at compile time, so a typo fails
 * loudly instead of never firing.
 *
 * Walks over a target file never recurse: a file's depth must not be able to
 * exhaust the stack. Only the author's own pattern is walked recursively.
 *
 * @module
 * @since 0.2.0
 */

import { Effect } from "effect";
import { Query, type Node as TSNode, type Tree } from "web-tree-sitter";
import type { AgentlintNode } from "../../domain/node.js";
import { wrapNode } from "../infrastructure/parsed-node.js";
import type { RuleMatch } from "../../domain/rule.js";
import type { RuleContextImpl } from "../../domain/rule-context.js";
import { Parser } from "../infrastructure/parser.js";

const SINGLE_METAVAR = /^\$[A-Z_][A-Z0-9_]*$/;
const MULTI_METAVAR = /^\$\$\$[A-Z0-9_]*$/;

type Captures = Map<string, AgentlintNode>;

/**
 * A pattern tree reduced to what matching reads. Built once at compile time, so a candidate costs no pattern text
 * lookup, and the pattern's native tree is released as soon as it is compiled.
 */
interface PatternNode {
  readonly type: string;
  /** Source text with whitespace runs collapsed. */
  readonly text: string;
  /** `$NAME` and `$_` stand for one node, `$$$NAME` for the remaining siblings. */
  readonly placeholder: "single" | "multi" | undefined;
  /** Named children only. */
  readonly children: ReadonlyArray<PatternNode>;
  /** Index of the sequence placeholder among `children`, or -1. */
  readonly multiIndex: number;
  /** A sibling list with two sequence placeholders has no single reading and matches nothing. */
  readonly ambiguous: boolean;
}

function namedChildren(node: AgentlintNode): ReadonlyArray<AgentlintNode> {
  return node.children.filter((child) => child.isNamed);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function toPatternNode(node: AgentlintNode): PatternNode {
  const text = normalizeText(node.text);
  const children = namedChildren(node).map(toPatternNode);
  const multiIndex = children.findIndex((child) => child.placeholder === "multi");
  return {
    type: node.type,
    text,
    placeholder: SINGLE_METAVAR.test(text) ? "single" : MULTI_METAVAR.test(text) ? "multi" : undefined,
    children,
    multiIndex,
    ambiguous: children.findLastIndex((child) => child.placeholder === "multi") !== multiIndex,
  };
}

/** Two nodes are the same code when their syntax trees agree. Formatting between tokens is not code. */
function sameCode(left: AgentlintNode, right: AgentlintNode): boolean {
  const pending: Array<readonly [AgentlintNode, AgentlintNode]> = [[left, right]];
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [a, b] = pair;
    if (a.type !== b.type || a.childCount !== b.childCount) return false;
    if (a.childCount === 0) {
      if (a.text !== b.text) return false;
      continue;
    }
    const others = b.children;
    for (const [index, child] of a.children.entries()) {
      const other = others[index];
      if (other === undefined) return false;
      pending.push([child, other]);
    }
  }
  return true;
}

/**
 * Structural comparison of a pattern node against a target node.
 *
 * @since 0.2.0
 * @category internals
 */
function matchNode(pattern: PatternNode, target: AgentlintNode, captures: Captures): boolean {
  if (pattern.placeholder === "single") {
    if (pattern.text === "$_") return true;
    // A placeholder that appears twice names the same code twice: `$A === $A` does not match `x === y`.
    const name = pattern.text.slice(1);
    const bound = captures.get(name);
    if (bound !== undefined) return sameCode(bound, target);
    captures.set(name, target);
    return true;
  }

  // `take: $_` also describes the shorthand property `{ take }`, which has the key as its only token.
  if (pattern.type === "pair" && target.type === "shorthand_property_identifier") {
    const [key, value] = pattern.children;
    return (
      key !== undefined &&
      value !== undefined &&
      key.text === normalizeText(target.text) &&
      value.placeholder === "single" &&
      matchNode(value, target, captures)
    );
  }

  if (pattern.type !== target.type) {
    // A bare `identifier` pattern leaf matches any identifier-kind node with
    // the same text (property_identifier, shorthand_property_identifier, ...),
    // so `where: { notHas: "signal" }` also covers `{ signal }` shorthand.
    const identifierLike = pattern.type === "identifier" && target.type.endsWith("identifier");
    if (!identifierLike) return false;
  }

  if (pattern.children.length === 0) {
    return pattern.text === normalizeText(target.text);
  }

  return matchChildren(pattern, namedChildren(target), captures);
}

function matchChildren(
  pattern: PatternNode,
  targetChildren: ReadonlyArray<AgentlintNode>,
  captures: Captures,
): boolean {
  const { children: patternChildren, multiIndex } = pattern;

  if (multiIndex === -1) {
    if (patternChildren.length !== targetChildren.length) return false;
    return patternChildren.every((child, index) => {
      const target = targetChildren[index];
      return target !== undefined && matchNode(child, target, captures);
    });
  }

  if (pattern.ambiguous) return false;
  const suffixLength = patternChildren.length - multiIndex - 1;
  if (targetChildren.length < multiIndex + suffixLength) return false;

  for (let index = 0; index < multiIndex; index++) {
    const child = patternChildren[index];
    const target = targetChildren[index];
    if (child === undefined || target === undefined || !matchNode(child, target, captures)) return false;
  }
  for (let index = 0; index < suffixLength; index++) {
    const child = patternChildren[multiIndex + 1 + index];
    const target = targetChildren[targetChildren.length - suffixLength + index];
    if (child === undefined || target === undefined || !matchNode(child, target, captures)) return false;
  }
  return true;
}

/**
 * Parse contexts tried in order when compiling a pattern. Fragments like
 * `limit: $_` are not valid statements, so they are re-parsed inside an
 * expression or object wrapper until one parses cleanly.
 */
const PATTERN_CONTEXTS: ReadonlyArray<(pattern: string) => string> = [
  (pattern) => pattern,
  // Object context before expression context: `limit: $_` must become an
  // object pair, not an expression with a bogus type annotation.
  (pattern) => `({${pattern}})`,
  (pattern) => `(${pattern})`,
];

function hasErrorNode(root: AgentlintNode): boolean {
  const pending = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === "ERROR" || node.type === "MISSING") return true;
    pending.push(...node.children);
  }
  return false;
}

/**
 * Descend while a node has exactly one named child, stripping parser
 * scaffolding (program, expression_statement, wrappers) down to the node
 * the author actually wrote.
 */
function effectivePatternNode(root: AgentlintNode): AgentlintNode {
  let node = root;
  for (;;) {
    const children = namedChildren(node);
    const [first] = children;
    if (children.length !== 1 || first === undefined) return node;
    node = first;
  }
}

/** `where` sub-patterns compiled for the same grammar as their pattern. */
interface ResolvedWhere {
  readonly has: PatternNode | undefined;
  readonly notHas: PatternNode | undefined;
}

interface CompiledPattern {
  readonly kind: "pattern";
  readonly rootType: string;
  readonly patternNode: PatternNode;
  readonly where: ResolvedWhere;
  readonly message: string;
}

interface CompiledQuery {
  readonly kind: "query";
  readonly query: Query;
  readonly message: string;
}

type CompiledMatch = CompiledPattern | CompiledQuery;

/**
 * Node types that indicate a fragment was parsed in a misleading context.
 * `limit: $_` parses raw as a labeled statement (and `(limit: $_)` as an
 * expression with a bogus type annotation), but the author almost always
 * means an object property — a later context wins when available.
 */
const DEPRIORITIZED_TYPES = new Set(["labeled_statement", "parenthesized_expression", "block"]);

/**
 * Compile a pattern string to its effective pattern node for `grammar`.
 *
 * @since 0.2.0
 * @category internals
 */
const compilePatternNode = Effect.fn("compilePatternNode")(function* (
  ruleId: string,
  pattern: string,
  grammar: string,
) {
  const parser = yield* Parser;
  let fallback: PatternNode | undefined;

  for (const context of PATTERN_CONTEXTS) {
    const result = yield* parser.parse(context(pattern), grammar).pipe(Effect.result);
    if (result._tag === "Failure") continue;
    const tree = result.success;
    const root = wrapNode(tree.rootNode);
    const node = hasErrorNode(root) ? undefined : toPatternNode(effectivePatternNode(root));
    tree.delete();
    if (node === undefined) continue;
    if (!DEPRIORITIZED_TYPES.has(node.type)) return node;
    fallback ??= node;
  }

  if (fallback) return fallback;

  return yield* new PatternError({ ruleId, reason: "pattern_parse", grammar, detail: pattern });
});

/** Compile one `match` entry, with its `where` constraints, for one grammar. */
const compileMatch = Effect.fn("compileMatch")(function* (ruleId: string, match: RuleMatch, grammar: string) {
  if (match.pattern !== undefined) {
    const patternNode = yield* compilePatternNode(ruleId, match.pattern, grammar);
    const has =
      match.where?.has !== undefined ? yield* compilePatternNode(ruleId, match.where.has, grammar) : undefined;
    const notHas =
      match.where?.notHas !== undefined ? yield* compilePatternNode(ruleId, match.where.notHas, grammar) : undefined;
    return {
      kind: "pattern",
      rootType: patternNode.type,
      patternNode,
      where: { has, notHas },
      message: match.message,
    } satisfies CompiledPattern;
  }
  if (match.query === undefined) return undefined;

  const parser = yield* Parser;
  const language = yield* parser.language(grammar);
  if (!language) return yield* new PatternError({ ruleId, reason: "unsupported_frontend", grammar });
  const source = match.query;
  const query = yield* Effect.try({
    try: () => new Query(language, source),
    catch: (error) =>
      new PatternError({
        ruleId,
        reason: "query_invalid",
        detail: error instanceof Error ? error.message : String(error),
      }),
  });
  return { kind: "query", query, message: match.message } satisfies CompiledQuery;
});

/**
 * A rule's matches compiled for one grammar.
 *
 * @since 0.2.0
 * @category models
 */
export interface RunnableMatches {
  readonly compiled: ReadonlyArray<CompiledMatch>;
  /** Pattern matches bucketed by the node type they can match, computed once. */
  readonly byType: ReadonlyMap<string, ReadonlyArray<CompiledPattern>>;
  /** Raw tree-sitter query matches, computed once. */
  readonly queries: ReadonlyArray<CompiledQuery>;
}

interface CompileInput {
  readonly ruleId: string;
  readonly matches: ReadonlyArray<RuleMatch>;
  readonly grammar: string;
  /** Every grammar among the files the rule applies to in this run. */
  readonly grammars: ReadonlyArray<string>;
}

/** Whether `match` is written in a language other than `grammar`, as opposed to being written wrong. */
function isLanguageMismatch(error: unknown): error is PatternError {
  return error instanceof PatternError && (error.reason === "pattern_parse" || error.reason === "query_invalid");
}

/**
 * Compile all `match` entries of a rule for one grammar.
 *
 * A binding can cover files of several languages while its pattern is code in one of them. A match that does not
 * compile for `grammar` is left out, so the rule finds nothing in those files, as long as it compiles for another
 * grammar in `grammars`. A match that compiles for none of them is a mistake and fails with its first error.
 *
 * @since 0.2.0
 * @category constructors
 */
export const compileMatches = Effect.fn("compileMatches")(function* (input: CompileInput) {
  const compiled: CompiledMatch[] = [];

  return yield* Effect.gen(function* () {
    for (const match of input.matches) {
      const result = yield* compileMatch(input.ruleId, match, input.grammar).pipe(Effect.result);
      if (result._tag === "Success") {
        if (result.success) compiled.push(result.success);
        continue;
      }
      if (!isLanguageMismatch(result.failure)) return yield* Effect.fail(result.failure);
      let compilesElsewhere = false;
      for (const grammar of input.grammars) {
        if (grammar === input.grammar || compilesElsewhere) continue;
        const other = yield* compileMatch(input.ruleId, match, grammar).pipe(Effect.result);
        if (other._tag !== "Success") continue;
        if (other.success) disposeCompiled([other.success]);
        compilesElsewhere = true;
      }
      if (!compilesElsewhere) return yield* Effect.fail(result.failure);
    }

    const byType = new Map<string, CompiledPattern[]>();
    const queries: CompiledQuery[] = [];
    for (const match of compiled) {
      if (match.kind === "query") {
        queries.push(match);
        continue;
      }
      const bucket = byType.get(match.rootType);
      if (bucket) bucket.push(match);
      else byType.set(match.rootType, [match]);
    }
    return { compiled, byType, queries } satisfies RunnableMatches;
  }).pipe(Effect.onError(() => Effect.sync(() => disposeCompiled(compiled))));
});

/**
 * A property constraint such as `take: $_` describes the properties of the matched code's own objects. It does not look
 * inside the value of another property: `{ where: { take: 1 } }` has no `take` option.
 */
function contains(root: TSNode, pattern: PatternNode): boolean {
  const cursor = root.walk();
  try {
    for (;;) {
      const type = cursor.nodeType;
      // Only a node that can pass the type checks of `matchNode` is worth wrapping.
      const comparable =
        pattern.placeholder === "single" ||
        pattern.type === type ||
        (pattern.type === "identifier" && type.endsWith("identifier")) ||
        (pattern.type === "pair" && type === "shorthand_property_identifier");
      if (comparable && matchNode(pattern, wrapNode(cursor.currentNode), new Map())) return true;
      const opaque = pattern.type === "pair" && type === "pair";
      if (!opaque && cursor.gotoFirstChild()) continue;
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return false;
      }
    }
  } finally {
    cursor.delete();
  }
}

function whereHolds(node: TSNode, where: ResolvedWhere): boolean {
  if (where.has && !contains(node, where.has)) return false;
  if (where.notHas && contains(node, where.notHas)) return false;
  return true;
}

function interpolatePattern(message: string, captures: Captures): string {
  return message.replace(/\$([A-Z_][A-Z0-9_]*)/g, (token, name: string) => {
    const captured = captures.get(name);
    if (!captured) return token;
    const firstLine = captured.text.split("\n")[0]?.trim() ?? "";
    return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
  });
}

function interpolateQuery(message: string, captures: ReadonlyArray<{ name: string; node: TSNode }>): string {
  return message.replace(/@([a-zA-Z_][a-zA-Z0-9_.-]*)/g, (token, name: string) => {
    const captured = captures.find((capture) => capture.name === name);
    if (!captured) return token;
    const firstLine = captured.node.text.split("\n")[0]?.trim() ?? "";
    return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
  });
}

function disposeCompiled(compiled: ReadonlyArray<CompiledMatch>): void {
  for (const match of compiled) {
    if (match.kind === "query") match.query.delete();
  }
}

/**
 * Release the native tree-sitter queries held by a compiled match set.
 * The set must not be run again afterwards.
 *
 * @since 0.2.0
 * @category execution
 */
export function disposeMatches(runnable: RunnableMatches): void {
  disposeCompiled(runnable.compiled);
}

const nodeKey = (node: AgentlintNode): string =>
  [node.type, node.startPosition.row, node.startPosition.column, node.endPosition.row, node.endPosition.column].join(
    ":",
  );

/**
 * Run compiled matches against a parsed file, reporting findings into the
 * rule's context.
 *
 * @since 0.2.0
 * @category execution
 */
export function runMatches(tree: Tree, runnable: RunnableMatches, context: RuleContextImpl): void {
  const { byType, queries } = runnable;
  const reported = new Set<string>();

  if (byType.size > 0) {
    const cursor = tree.walk();
    // Child indices from the root to the cursor, so a finding's structural position needs no climb back up.
    const position: number[] = [];
    try {
      for (let reachedEnd = false; !reachedEnd;) {
        const candidates = byType.get(cursor.nodeType);
        if (candidates) {
          const inner = cursor.currentNode;
          const node = wrapNode(inner);
          for (const candidate of candidates) {
            const captures: Captures = new Map();
            if (matchNode(candidate.patternNode, node, captures) && whereHolds(inner, candidate.where)) {
              // One node is one finding for a rule. The first declared match that applies names it.
              reported.add(nodeKey(node));
              context.reportAt({ node, message: interpolatePattern(candidate.message, captures) }, position);
              break;
            }
          }
        }

        if (cursor.gotoFirstChild()) {
          position.push(0);
          continue;
        }
        while (!cursor.gotoNextSibling()) {
          if (!cursor.gotoParent()) {
            reachedEnd = true;
            break;
          }
          position.pop();
        }
        if (!reachedEnd) position[position.length - 1] = (position.at(-1) ?? 0) + 1;
      }
    } finally {
      cursor.delete();
    }
  }

  for (const compiledQuery of queries) {
    for (const match of compiledQuery.query.matches(tree.rootNode)) {
      const selected = match.captures.find((capture) => capture.name === "match") ?? match.captures[0];
      if (!selected) continue;
      const node = wrapNode(selected.node);
      if (reported.has(nodeKey(node))) continue;
      reported.add(nodeKey(node));
      context.report({
        node,
        message: interpolateQuery(compiledQuery.message, match.captures),
      });
    }
  }
}
