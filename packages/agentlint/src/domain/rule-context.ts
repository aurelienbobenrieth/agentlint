/** State detector context and finding construction. @module @since 0.2.0 */

import { canonicalDigest, fingerprintState } from "./fingerprint.js";
import type { CanonicalValue } from "./fingerprint.js";
import { type FindingOptions, FindingRecord } from "./finding.js";
import type { AgentlintNode, Position } from "./node.js";
import type { StateRule } from "./rule.js";
import { findingSourceForRule } from "./rule-identity.js";

/** What a state detector sees while one file is being walked. */
export interface RuleContext {
  /** Absolute filesystem path of the current file. */
  readonly absolutePath: string;
  /** Repository-relative, forward-slash path of the current file. */
  readonly path: string;
  /** Full source text of the current file. */
  readonly source: string;
  /** Explicit repository-relative binding dependencies, captured before detection. */
  readonly dependencies: Readonly<Record<string, string>>;
  report(options: FindingOptions): void;
}

/** Offsets of each line start. Node columns count UTF-16 code units, as string indices do. */
function lineStarts(source: string): ReadonlyArray<number> {
  const starts = [0];
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1)) starts.push(index + 1);
  return starts;
}

/**
 * Canonical evidence for the tree under `root`, which must span `source`.
 *
 * A preorder list: every node contributes its type and child count, then a leaf contributes its text and an inner node
 * the source text around its children. A grammar can leave source text outside every node (the literal parts of a
 * template literal type), so a gap that holds anything but whitespace is evidence, kept verbatim. A whitespace-only gap
 * is formatting and contributes `""`. The list is flat and built without recursion so that depth costs no stack.
 */
export function semanticStructure(root: AgentlintNode, source: string): ReadonlyArray<string | number> {
  const starts = lineStarts(source);
  const offset = (position: Position): number => (starts[position.row] ?? source.length) + position.column;
  const structure: Array<string | number> = [];
  const pending: Array<AgentlintNode | string> = [root];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === "string") {
      structure.push(/\S/.test(next) ? next : "");
      continue;
    }
    const children = next.children;
    structure.push(next.type, children.length);
    if (children.length === 0) {
      structure.push(source.slice(offset(next.startPosition), offset(next.endPosition)));
      continue;
    }
    const entries: Array<AgentlintNode | string> = [];
    let end = offset(next.startPosition);
    for (const child of children) {
      entries.push(source.slice(end, offset(child.startPosition)), child);
      end = offset(child.endPosition);
    }
    entries.push(source.slice(end, offset(next.endPosition)));
    // Reversed so that gaps and children pop in source order.
    for (let index = entries.length - 1; index >= 0; index--) pending.push(entries[index] ?? "");
  }
  return structure;
}

function comparePositions(left: Position, right: Position): number {
  return left.row - right.row || left.column - right.column;
}

function sameNode(left: AgentlintNode, right: AgentlintNode): boolean {
  return (
    left.type === right.type &&
    comparePositions(left.startPosition, right.startPosition) === 0 &&
    comparePositions(left.endPosition, right.endPosition) === 0
  );
}

/** Index of `child` among source-ordered `siblings`, or -1. Binary search to the first sibling at its start, then scan. */
function siblingIndex(siblings: ReadonlyArray<AgentlintNode>, child: AgentlintNode): number {
  let low = 0;
  let high = siblings.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const sibling = siblings[middle];
    if (sibling !== undefined && comparePositions(sibling.startPosition, child.startPosition) < 0) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < siblings.length; index++) {
    const sibling = siblings[index];
    if (sibling === undefined || comparePositions(sibling.startPosition, child.startPosition) !== 0) break;
    if (sameNode(sibling, child)) return index;
  }
  return -1;
}

export class RuleContextImpl implements RuleContext {
  readonly rule: StateRule;
  readonly findings: FindingRecord[] = [];

  #absolutePath = "";
  #file = "";
  #source = "";
  #keys = new Set<string>();
  /** The first root seen for the current file. Its wrapped children are reused by every later report. */
  #root: AgentlintNode | undefined;
  #fileStructure: CanonicalValue | undefined;
  /** The node the walker is handing to visitors, with its child indices from the file root. */
  #visiting: { readonly node: AgentlintNode; readonly position: ReadonlyArray<number> } | undefined;
  #dependencyDigest: string;
  #sourceIdentity: ReturnType<typeof findingSourceForRule>;

  constructor(
    rule: StateRule,
    readonly dependencies: Readonly<Record<string, string>> = {},
  ) {
    this.rule = rule;
    this.#sourceIdentity = findingSourceForRule(rule);
    this.#dependencyDigest = canonicalDigest(dependencies);
  }

  setFile(absolutePath: string, file: string, source: string): void {
    this.#absolutePath = absolutePath;
    this.#file = file.replace(/\\/g, "/");
    this.#source = source;
    this.#keys = new Set();
    this.#root = undefined;
    this.#visiting = undefined;
    this.#fileStructure = undefined;
  }

  drainFindings(): FindingRecord[] {
    return this.findings.splice(0);
  }

  get absolutePath(): string {
    return this.#absolutePath;
  }

  get path(): string {
    return this.#file;
  }

  get source(): string {
    return this.#source;
  }

  /**
   * Child indices from the file root down to `node`. One climb collects the ancestors and one descent through the
   * retained root locates each of them, so a report costs the node's depth and wraps no sibling twice.
   */
  #position(node: AgentlintNode): ReadonlyArray<number> {
    const ancestors = [node];
    for (let parent = node.parent; parent; parent = parent.parent) ancestors.push(parent);
    this.#root ??= ancestors.at(-1) ?? node;

    const position: number[] = [];
    let current = this.#root;
    for (let depth = ancestors.length - 2; depth >= 0; depth--) {
      const ancestor = ancestors[depth];
      if (ancestor === undefined) break;
      const index = siblingIndex(current.children, ancestor);
      position.push(index);
      current = current.children[index] ?? ancestor;
    }
    return position;
  }

  /**
   * Called by the walker before it dispatches `node`, so that reporting the visited node needs no climb. The position
   * is copied: a visitor may keep the node and report it after the walker has moved on.
   */
  visit(node: AgentlintNode, position: ReadonlyArray<number>): void {
    this.#visiting = { node, position: [...position] };
  }

  report(options: FindingOptions): void {
    const visiting = this.#visiting;
    this.reportAt(options, visiting?.node === options.node ? visiting.position : this.#position(options.node));
  }

  /** Report a node whose child indices from the file root the caller tracked during its own descent. */
  reportAt(options: FindingOptions, position: ReadonlyArray<number>): void {
    const line = options.node.startPosition.row + 1;
    const column = options.node.startPosition.column + 1;
    const endLine = options.node.endPosition.row + 1;
    const endColumn = options.node.endPosition.column + 1;
    const nodeSnippet = options.node.text.split("\n")[0]?.trim() ?? "";
    const rawSnippet = nodeSnippet;
    const sourceSnippet = rawSnippet.length > 160 ? `${rawSnippet.slice(0, 157)}...` : rawSnippet;
    if (this.#fileStructure === undefined) {
      let root = this.#root ?? options.node;
      for (let parent = root.parent; parent; parent = parent.parent) root = parent;
      this.#root = root;
      this.#fileStructure = canonicalDigest(semanticStructure(root, this.#source));
    }
    const occurrenceKey = options.key ?? `${options.node.type}:${position.join("/")}`;
    if (!occurrenceKey.trim() || this.#keys.has(occurrenceKey)) {
      throw new Error(`Rule ${this.rule.binding.id} reported a duplicate or empty finding key: ${occurrenceKey}`);
    }
    this.#keys.add(occurrenceKey);
    const structure = {
      file: this.#fileStructure,
      dependencies: this.#dependencyDigest,
      evidence: options.evidence ?? null,
    };

    this.findings.push(
      new FindingRecord({
        selector: undefined,
        ruleId: this.rule.binding.id,
        lifecycle: "state",
        authority: this.rule.binding.authority,
        source: this.#sourceIdentity,
        fingerprint: fingerprintState({
          path: this.#file,
          structure,
          occurrence: occurrenceKey,
        }),
        lineageKey: canonicalDigest({
          kind: "state-lineage",
          bindingId: this.rule.binding.id,
          path: this.#file,
          occurrence: occurrenceKey,
        }),
        file: this.#file,
        line,
        column,
        endLine,
        endColumn,
        message: options.message,
        sourceSnippet,
      }),
    );
  }
}
