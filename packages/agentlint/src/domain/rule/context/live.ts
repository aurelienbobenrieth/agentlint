/**
 * State detector context and finding construction. @module @since 0.2.0
 */

import { canonicalDigest, fingerprintState, legacyStateFingerprint, repositoryPath } from "../../fingerprint.js";
import { Result, Schema } from "effect";
import { type FindingOptions, FindingRecord } from "../../finding.js";
import type { AgentlintNode, Position } from "../../node.js";
import { findingSourceForRule } from "../identity.js";
import { DetectorContractError, type StateRule } from "../model.js";
import { normalizeFile } from "./structure.js";
import type { RuleContext } from "./model.js";

/**
 * Offsets of each line start. Node columns count UTF-16 code units, as string indices do.
 */
function lineStarts(source: string): ReadonlyArray<number> {
  return [0, ...Array.from(source.matchAll(/\n/gu), (match) => match.index + 1)];
}

/**
 * Canonical evidence for the tree under `root`, which must span `source`.
 *
 * A preorder list: every node contributes its type and child count, then a leaf contributes its text and an inner node
 * the source text around its children. A grammar can leave source text outside every node (the literal parts of a
 * template literal type), so a gap that holds anything but whitespace is evidence, kept verbatim. A whitespace-only gap
 * is formatting and contributes `""`. The list is flat and built without recursion so that depth costs no stack.
 */
export function semanticStructure({
  root,
  source,
}: {
  readonly root: AgentlintNode;
  readonly source: string;
}): ReadonlyArray<string | number> {
  const starts = lineStarts(source);
  const offset = (position: Position): number => (starts[position.row] ?? source.length) + position.column;
  const structure: Array<string | number> = [];
  const pending: Array<AgentlintNode | string> = [root];

  const traversal = { next: pending.pop() };
  while (traversal.next !== undefined) {
    const next = traversal.next;
    if (Schema.is(Schema.String)(next)) {
      structure.push(/\S/.test(next) ? next : "");
      traversal.next = pending.pop();
      continue;
    }
    const children = next.children;
    structure.push(next.type, children.length);
    if (children.length === 0) {
      structure.push(source.slice(offset(next.startPosition), offset(next.endPosition)));
      traversal.next = pending.pop();
      continue;
    }
    const entries: Array<AgentlintNode | string> = [];
    const span = { end: offset(next.startPosition) };
    for (const child of children) {
      entries.push(source.slice(span.end, offset(child.startPosition)), child);
      span.end = offset(child.endPosition);
    }
    entries.push(source.slice(span.end, offset(next.endPosition)));
    // Reversed so that gaps and children pop in source order.
    for (const entry of entries.toReversed()) pending.push(entry);
    traversal.next = pending.pop();
  }
  return structure;
}

/**
 * A file's structure digests, `current` for `source-structure` v4 and `legacy` for v3, and where a node sits in v4's.
 */
export interface StructureDigests {
  readonly current: string;
  readonly legacy: string;
  readonly occurrence: (node: AgentlintNode) => string;
}

/**
 * The digests of a file's structure, computed once for every rule that reports in the file. All of a file's nodes share
 * its one root, so the first report's root answers for the others.
 */
export function fileStructureDigest(source: string): (root: AgentlintNode) => StructureDigests {
  const memo: { digests: StructureDigests | undefined } = { digests: undefined };
  return (root) => {
    if (memo.digests) return memo.digests;
    const normalized = normalizeFile({ root, source });
    memo.digests = {
      current: canonicalDigest(normalized.structure),
      legacy: canonicalDigest(semanticStructure({ root, source })),
      occurrence: normalized.occurrence,
    };
    return memo.digests;
  };
}

function comparePositions({ left, right }: { readonly left: Position; readonly right: Position }): number {
  return left.row - right.row || left.column - right.column;
}

function sameNode({ left, right }: { readonly left: AgentlintNode; readonly right: AgentlintNode }): boolean {
  return (
    left.type === right.type &&
    comparePositions({ left: left.startPosition, right: right.startPosition }) === 0 &&
    comparePositions({ left: left.endPosition, right: right.endPosition }) === 0
  );
}

/**
 * Index of `child` among source-ordered `siblings`, or -1. Binary search to the first sibling at its start, then scan.
 */
function siblingIndex({
  siblings,
  child,
}: {
  readonly siblings: ReadonlyArray<AgentlintNode>;
  readonly child: AgentlintNode;
}): number {
  const bounds = { low: 0, high: siblings.length };
  while (bounds.low < bounds.high) {
    const middle = (bounds.low + bounds.high) >>> 1;
    const sibling = siblings[middle];
    if (sibling !== undefined && comparePositions({ left: sibling.startPosition, right: child.startPosition }) < 0)
      bounds.low = middle + 1;
    else bounds.high = middle;
  }
  for (const index of siblings.keys()) {
    if (index < bounds.low) continue;
    const sibling = siblings[index];
    if (sibling === undefined || comparePositions({ left: sibling.startPosition, right: child.startPosition }) !== 0)
      break;
    if (sameNode({ left: sibling, right: child })) return index;
  }
  return -1;
}

export class RuleContextImpl implements RuleContext {
  readonly rule: StateRule;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly findings: FindingRecord[] = [];

  #absolutePath = "";
  #file = "";
  #source = "";
  #keys = new Set<string>();
  /**
   * The first root seen for the current file. Its wrapped children are reused by every later report.
   */
  #root: AgentlintNode | undefined;
  #fileStructure: StructureDigests | undefined;
  #structureDigest: ((root: AgentlintNode) => StructureDigests) | undefined;
  /**
   * Occurrences taken in the current file under v4, which folds some distinct nodes (parentheses and what they wrap).
   */
  #occurrences = new Set<string>();
  /**
   * The node the walker is handing to visitors, with its child indices from the file root.
   */
  #visiting: { readonly node: AgentlintNode; readonly position: ReadonlyArray<number> } | undefined;
  #dependencyDigest: string;
  #sourceIdentity: ReturnType<typeof findingSourceForRule>;

  constructor({
    rule,
    dependencies = {},
  }: {
    readonly rule: StateRule;
    readonly dependencies?: Readonly<Record<string, string>>;
  }) {
    this.rule = rule;
    this.dependencies = dependencies;
    this.#sourceIdentity = findingSourceForRule(rule);
    this.#dependencyDigest = canonicalDigest(dependencies);
  }

  setFile({
    absolutePath,
    file,
    source,
    structureDigest,
  }: {
    readonly absolutePath: string;
    readonly file: string;
    readonly source: string;
    /**
     * Shared by the rules walking the same file; see `fileStructureDigest`.
     */
    readonly structureDigest?: (root: AgentlintNode) => StructureDigests;
  }): void {
    this.#absolutePath = absolutePath;
    this.#file = file.replace(/\\/g, "/");
    this.#source = source;
    this.#keys = new Set();
    this.#occurrences = new Set();
    this.#root = undefined;
    this.#visiting = undefined;
    this.#fileStructure = undefined;
    this.#structureDigest = structureDigest ?? fileStructureDigest(source);
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
    const lineage = { parent: node.parent };
    while (lineage.parent) {
      ancestors.push(lineage.parent);
      lineage.parent = lineage.parent.parent;
    }
    this.#root ??= ancestors.at(-1) ?? node;

    const position: number[] = [];
    const descent = { current: this.#root };
    for (const depth of Array.from(ancestors.keys()).toReversed()) {
      if (depth >= ancestors.length - 1) continue;
      const ancestor = ancestors[depth];
      if (ancestor === undefined) break;
      const index = siblingIndex({ siblings: descent.current.children, child: ancestor });
      position.push(index);
      descent.current = descent.current.children[index] ?? ancestor;
    }
    return position;
  }

  /**
   * Called by the walker before it dispatches `node`, so that reporting the visited node needs no climb. The position
   * is copied: a visitor may keep the node and report it after the walker has moved on.
   */
  visit({ node, position }: { readonly node: AgentlintNode; readonly position: ReadonlyArray<number> }): void {
    this.#visiting = { node, position: [...position] };
  }

  #reportError(reason: DetectorContractError["reason"], detail: string): DetectorContractError {
    return new DetectorContractError({ ruleId: this.rule.binding.id, reason, detail });
  }

  report(options: FindingOptions): void {
    const visiting = this.#visiting;
    this.reportAt({
      options,
      position: visiting?.node === options.node ? visiting.position : this.#position(options.node),
    });
  }

  /**
   * Report a node whose child indices from the file root the caller tracked during its own descent.
   */
  reportAt({
    options,
    position,
  }: {
    readonly options: FindingOptions;
    readonly position: ReadonlyArray<number>;
  }): void {
    const line = options.node.startPosition.row + 1;
    const column = options.node.startPosition.column + 1;
    const endLine = options.node.endPosition.row + 1;
    const endColumn = options.node.endPosition.column + 1;
    const nodeSnippet = options.node.text.split("\n")[0]?.trim() ?? "";
    const rawSnippet = nodeSnippet;
    const sourceSnippet = rawSnippet.length > 160 ? `${rawSnippet.slice(0, 157)}...` : rawSnippet;
    if (this.#fileStructure === undefined) {
      const root = { node: this.#root ?? options.node };
      while (root.node.parent) root.node = root.node.parent;
      this.#root = root.node;
      this.#fileStructure = (this.#structureDigest ?? fileStructureDigest(this.#source))(root.node);
    }
    const occurrenceKey = options.key ?? `${options.node.type}:${position.join("/")}`;
    if (!occurrenceKey.trim()) throw this.#reportError("empty_key", occurrenceKey);
    if (this.#keys.has(occurrenceKey)) throw this.#reportError("duplicate_key", occurrenceKey);
    this.#keys.add(occurrenceKey);
    // Two reported nodes v4 folds into one slot (parentheses and their content) stay two findings.
    const slot = options.key ?? this.#fileStructure.occurrence(options.node);
    const occurrence = this.#occurrences.has(slot) ? `${slot}#${occurrenceKey}` : slot;
    this.#occurrences.add(occurrence);
    const evidence = (file: string) => ({
      file,
      dependencies: this.#dependencyDigest,
      evidence: options.evidence ?? null,
    });
    const relatedFiles = [
      ...new Set(
        (options.relatedFiles ?? []).map((file) => {
          const normalized = repositoryPath(file);
          if (Result.isFailure(normalized)) throw this.#reportError("invalid_path", normalized.failure.detail);
          return normalized.success;
        }),
      ),
    ].toSorted();
    for (const related of relatedFiles) {
      if (!Object.hasOwn(this.dependencies, related)) throw this.#reportError("undeclared_related", related);
    }

    this.findings.push(
      new FindingRecord({
        selector: undefined,
        ruleId: this.rule.binding.id,
        lifecycle: "state",
        authority: this.rule.binding.authority,
        source: this.#sourceIdentity,
        fingerprint: fingerprintState({
          path: this.#file,
          structure: evidence(this.#fileStructure.current),
          occurrence,
        }),
        legacyFingerprints: [
          legacyStateFingerprint({
            path: this.#file,
            structure: evidence(this.#fileStructure.legacy),
            occurrence: occurrenceKey,
          }),
        ],
        lineageKey: canonicalDigest({
          kind: "state-lineage",
          bindingId: this.rule.binding.id,
          path: this.#file,
          occurrence,
        }),
        file: this.#file,
        line,
        column,
        endLine,
        endColumn,
        message: options.message,
        sourceSnippet,
        relatedFiles,
      }),
    );
  }
}
