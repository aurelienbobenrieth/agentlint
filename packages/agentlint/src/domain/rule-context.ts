/** State detector context and finding construction. @module @since 0.2.0 */

import { canonicalDigest, fingerprintState } from "./fingerprint.js";
import type { CanonicalValue } from "./fingerprint.js";
import { type FindingOptions, FindingRecord } from "./finding.js";
import type { AgentlintNode } from "./node.js";
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

function semanticStructure(node: AgentlintNode): CanonicalValue {
  return node.childCount === 0
    ? { type: node.type, text: node.text }
    : { type: node.type, children: node.children.map(semanticStructure) };
}

export class RuleContextImpl implements RuleContext {
  readonly rule: StateRule;
  readonly findings: FindingRecord[] = [];

  #absolutePath = "";
  #file = "";
  #source = "";
  #keys = new Set<string>();
  #fileStructure: CanonicalValue | undefined;
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

  report(options: FindingOptions): void {
    const line = options.node.startPosition.row + 1;
    const column = options.node.startPosition.column + 1;
    const endLine = options.node.endPosition.row + 1;
    const endColumn = options.node.endPosition.column + 1;
    const nodeSnippet = options.node.text.split("\n")[0]?.trim() ?? "";
    const rawSnippet = nodeSnippet;
    const sourceSnippet = rawSnippet.length > 160 ? `${rawSnippet.slice(0, 157)}...` : rawSnippet;
    const position: number[] = [];
    let root = options.node;
    for (let parent = root.parent; parent; parent = root.parent) {
      const child = root;
      position.unshift(
        parent.children.findIndex(
          (candidate) =>
            candidate.type === child.type &&
            candidate.startPosition.row === child.startPosition.row &&
            candidate.startPosition.column === child.startPosition.column &&
            candidate.endPosition.row === child.endPosition.row &&
            candidate.endPosition.column === child.endPosition.column,
        ),
      );
      root = parent;
    }
    this.#fileStructure ??= canonicalDigest(semanticStructure(root));
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
        absolutePath: this.#absolutePath,
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
