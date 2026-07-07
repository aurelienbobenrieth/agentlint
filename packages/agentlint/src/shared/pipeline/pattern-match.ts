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
 * @module
 * @since 0.2.0
 */

import { Effect, Schema } from "effect";
import { Query, type Node as TSNode, type Tree } from "web-tree-sitter";
import type { AgentlintNode } from "../../domain/node.js";
import { wrapNode } from "../../domain/node.js";
import type { RuleMatch } from "../../domain/rule.js";
import type { RuleContextImpl } from "../../domain/rule-context.js";
import { Parser } from "../infrastructure/parser.js";

/**
 * Raised when a `match` definition cannot be compiled for a grammar —
 * a pattern that does not parse, or a malformed tree-sitter query.
 *
 * @since 0.2.0
 * @category errors
 */
export class PatternError extends Schema.TaggedErrorClass<PatternError>()("agentlint/PatternError", {
  ruleId: Schema.String,
  reason: Schema.Literals(["pattern_parse", "query_invalid", "unsupported_frontend", "unknown_fixture_grammar"]),
  grammar: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    switch (this.reason) {
      case "pattern_parse":
        return `Rule ${this.ruleId}: pattern does not parse as ${this.grammar}: ${this.detail}`;
      case "query_invalid":
        return `Rule ${this.ruleId}: invalid tree-sitter query: ${this.detail}`;
      case "unsupported_frontend":
        return `Rule ${this.ruleId}: "query" matches are not supported for the ${this.grammar} frontend`;
      case "unknown_fixture_grammar":
        return `Rule ${this.ruleId}: no grammar registered for fixture file "${this.detail}"`;
    }
  }
}

const SINGLE_METAVAR = /^\$[A-Z_][A-Z0-9_]*$/;
const MULTI_METAVAR = /^\$\$\$[A-Z0-9_]*$/;

function isSingleMetavar(text: string): boolean {
  return SINGLE_METAVAR.test(text);
}

function isMultiMetavar(text: string): boolean {
  return MULTI_METAVAR.test(text);
}

type Captures = Map<string, AgentlintNode>;

function namedChildren(node: AgentlintNode): ReadonlyArray<AgentlintNode> {
  return node.children.filter((child) => child.isNamed);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Structural comparison of a pattern node against a target node.
 *
 * @since 0.2.0
 * @category internals
 */
function matchNode(pattern: AgentlintNode, target: AgentlintNode, captures: Captures): boolean {
  const patternText = pattern.text.trim();

  if (isSingleMetavar(patternText)) {
    if (patternText !== "$_") captures.set(patternText.slice(1), target);
    return true;
  }

  if (pattern.type !== target.type) {
    // A bare `identifier` pattern leaf matches any identifier-kind node with
    // the same text (property_identifier, shorthand_property_identifier, ...),
    // so `where: { notHas: "signal" }` also covers `{ signal }` shorthand.
    const identifierLike = pattern.type === "identifier" && target.type.endsWith("identifier");
    if (!identifierLike) return false;
  }

  const patternChildren = namedChildren(pattern);
  if (patternChildren.length === 0) {
    return normalizeText(pattern.text) === normalizeText(target.text);
  }

  return matchChildren(patternChildren, namedChildren(target), captures);
}

function matchChildren(
  patternChildren: ReadonlyArray<AgentlintNode>,
  targetChildren: ReadonlyArray<AgentlintNode>,
  captures: Captures,
): boolean {
  const multiIndex = patternChildren.findIndex((child) => isMultiMetavar(child.text.trim()));

  if (multiIndex === -1) {
    if (patternChildren.length !== targetChildren.length) return false;
    return patternChildren.every((child, index) => {
      const target = targetChildren[index];
      return target !== undefined && matchNode(child, target, captures);
    });
  }

  const prefix = patternChildren.slice(0, multiIndex);
  const suffix = patternChildren.slice(multiIndex + 1);
  if (suffix.some((child) => isMultiMetavar(child.text.trim()))) return false;
  if (targetChildren.length < prefix.length + suffix.length) return false;

  for (const [index, child] of prefix.entries()) {
    const target = targetChildren[index];
    if (target === undefined || !matchNode(child, target, captures)) return false;
  }
  for (const [index, child] of suffix.entries()) {
    const target = targetChildren[targetChildren.length - suffix.length + index];
    if (target === undefined || !matchNode(child, target, captures)) return false;
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

function hasErrorNode(node: AgentlintNode): boolean {
  if (node.type === "ERROR" || node.type === "MISSING") return true;
  return node.children.some((child) => hasErrorNode(child));
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

interface CompiledPattern {
  readonly kind: "pattern";
  readonly rootType: string;
  readonly patternNode: AgentlintNode;
  readonly where: RuleMatch["where"];
  readonly message: string;
  /** Keeps the pattern's tree alive as long as its nodes are referenced. */
  readonly tree: Tree;
}

interface CompiledQuery {
  readonly kind: "query";
  readonly query: Query;
  readonly message: string;
}

export type CompiledMatch = CompiledPattern | CompiledQuery;

interface CompileInput {
  readonly ruleId: string;
  readonly matches: ReadonlyArray<RuleMatch>;
  readonly grammar: string;
}

/**
 * Compile a pattern string to its effective pattern node for `grammar`.
 *
 * @since 0.2.0
 * @category internals
 */
/**
 * Node types that indicate a fragment was parsed in a misleading context.
 * `limit: $_` parses raw as a labeled statement (and `(limit: $_)` as an
 * expression with a bogus type annotation), but the author almost always
 * means an object property — a later context wins when available.
 */
const DEPRIORITIZED_TYPES = new Set(["labeled_statement", "parenthesized_expression", "block"]);

const compilePatternNode = Effect.fn("compilePatternNode")(function* (
  ruleId: string,
  pattern: string,
  grammar: string,
) {
  const parser = yield* Parser;
  let fallback: { node: AgentlintNode; tree: Tree } | undefined;

  for (const context of PATTERN_CONTEXTS) {
    const result = yield* parser.parse(context(pattern), grammar).pipe(Effect.result);
    if (result._tag === "Failure") continue;
    const root = wrapNode(result.success.rootNode);
    if (hasErrorNode(root)) continue;
    const node = effectivePatternNode(root);
    if (DEPRIORITIZED_TYPES.has(node.type)) {
      fallback = fallback ?? { node, tree: result.success };
      continue;
    }
    return { node, tree: result.success };
  }

  if (fallback) return fallback;

  return yield* new PatternError({ ruleId, reason: "pattern_parse", grammar, detail: pattern });
});

/**
 * Compile all `match` entries of a rule for one grammar.
 *
 * @since 0.2.0
 * @category constructors
 */
export const compileMatches = Effect.fn("compileMatches")(function* (input: CompileInput) {
  const parser = yield* Parser;
  const compiled: CompiledMatch[] = [];

  for (const match of input.matches) {
    if (match.pattern !== undefined) {
      const { node, tree } = yield* compilePatternNode(input.ruleId, match.pattern, input.grammar);
      compiled.push({
        kind: "pattern",
        rootType: node.type,
        patternNode: node,
        where: match.where,
        message: match.message,
        tree,
      });
    } else if (match.query !== undefined) {
      const language = yield* parser.language(input.grammar);
      if (!language) {
        return yield* new PatternError({
          ruleId: input.ruleId,
          reason: "unsupported_frontend",
          grammar: input.grammar,
        });
      }
      const query = yield* Effect.try({
        try: () => new Query(language, match.query ?? ""),
        catch: (error) =>
          new PatternError({
            ruleId: input.ruleId,
            reason: "query_invalid",
            detail: error instanceof Error ? error.message : String(error),
          }),
      });
      compiled.push({ kind: "query", query, message: match.message });
    }
  }

  return compiled as ReadonlyArray<CompiledMatch>;
});

function someDescendantOrSelf(node: AgentlintNode, predicate: (candidate: AgentlintNode) => boolean): boolean {
  if (predicate(node)) return true;
  return node.children.some((child) => someDescendantOrSelf(child, predicate));
}

/**
 * Evaluate a compiled pattern's `where` constraints against a matched node.
 * Constraint sub-patterns are compiled by the caller and passed in resolved
 * form to keep this function pure.
 */
interface ResolvedWhere {
  readonly has: AgentlintNode | undefined;
  readonly notHas: AgentlintNode | undefined;
}

function whereHolds(node: AgentlintNode, where: ResolvedWhere): boolean {
  if (where.has) {
    const pattern = where.has;
    if (!someDescendantOrSelf(node, (candidate) => matchNode(pattern, candidate, new Map()))) return false;
  }
  if (where.notHas) {
    const pattern = where.notHas;
    if (someDescendantOrSelf(node, (candidate) => matchNode(pattern, candidate, new Map()))) return false;
  }
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

/**
 * A compiled match set plus the resolved `where` sub-patterns.
 *
 * @since 0.2.0
 * @category models
 */
export interface RunnableMatches {
  readonly compiled: ReadonlyArray<CompiledMatch>;
  readonly resolvedWhere: ReadonlyMap<CompiledMatch, ResolvedWhere>;
}

/**
 * Resolve `where` constraint sub-patterns for a compiled match set.
 *
 * @since 0.2.0
 * @category constructors
 */
export const resolveWhereClauses = Effect.fn("resolveWhereClauses")(function* (
  ruleId: string,
  compiled: ReadonlyArray<CompiledMatch>,
  grammar: string,
) {
  const resolvedWhere = new Map<CompiledMatch, ResolvedWhere>();
  for (const match of compiled) {
    if (match.kind !== "pattern") continue;
    const has =
      match.where?.has !== undefined ? (yield* compilePatternNode(ruleId, match.where.has, grammar)).node : undefined;
    const notHas =
      match.where?.notHas !== undefined
        ? (yield* compilePatternNode(ruleId, match.where.notHas, grammar)).node
        : undefined;
    resolvedWhere.set(match, { has, notHas });
  }
  return { compiled, resolvedWhere } satisfies RunnableMatches;
});

const EMPTY_WHERE: ResolvedWhere = { has: undefined, notHas: undefined };

/**
 * Run compiled matches against a parsed file, reporting findings into the
 * rule's context.
 *
 * @since 0.2.0
 * @category execution
 */
export function runMatches(tree: Tree, runnable: RunnableMatches, context: RuleContextImpl): void {
  const patterns = runnable.compiled.filter((match) => match.kind === "pattern");
  const queries = runnable.compiled.filter((match) => match.kind === "query");

  if (patterns.length > 0) {
    const root = wrapNode(tree.rootNode);
    const byType = new Map<string, CompiledPattern[]>();
    for (const pattern of patterns) {
      byType.set(pattern.rootType, [...(byType.get(pattern.rootType) ?? []), pattern]);
    }

    const visit = (node: AgentlintNode): void => {
      const candidates = byType.get(node.type);
      if (candidates) {
        for (const candidate of candidates) {
          const captures: Captures = new Map();
          if (matchNode(candidate.patternNode, node, captures)) {
            const where = runnable.resolvedWhere.get(candidate) ?? EMPTY_WHERE;
            if (whereHolds(node, where)) {
              context.report({ node, message: interpolatePattern(candidate.message, captures) });
            }
          }
        }
      }
      for (const child of node.children) visit(child);
    };
    visit(root);
  }

  for (const compiledQuery of queries) {
    for (const match of compiledQuery.query.matches(tree.rootNode)) {
      const reported = match.captures.find((capture) => capture.name === "match") ?? match.captures[0];
      if (!reported) continue;
      context.report({
        node: wrapNode(reported.node),
        message: interpolateQuery(compiledQuery.message, match.captures),
      });
    }
  }
}
