/**
 * Change detector context and finding construction. @module @since 0.2.0
 */

import { canonicalDigest, fingerprintChange, normalizeRepositoryPath } from "../../fingerprint.js";
import { FindingRecord } from "../../finding.js";
import { findingSourceForRule } from "../identity.js";
import type { ChangeFindingOptions, ChangeRule, ChangeRuleContext, ChangeSet, ChangedFile } from "../model.js";

function operation(file: ChangedFile): "add" | "delete" | "modify" | "rename" {
  const operations = {
    added: "add",
    deleted: "delete",
    renamed: "rename",
    modified: "modify",
  } as const satisfies Readonly<Record<ChangedFile["status"], "add" | "delete" | "modify" | "rename">>;
  return operations[file.status];
}

export class ChangeRuleContextImpl implements ChangeRuleContext {
  readonly rule: ChangeRule;
  readonly change: ChangeSet;
  readonly findings: FindingRecord[] = [];
  #keys = new Set<string>();
  #sourceIdentity: ReturnType<typeof findingSourceForRule>;

  constructor({ rule, change }: { readonly rule: ChangeRule; readonly change: ChangeSet }) {
    this.rule = rule;
    this.change = change;
    this.#sourceIdentity = findingSourceForRule(rule);
  }

  report(options: ChangeFindingOptions): void {
    const filePath = normalizeRepositoryPath(options.file);
    const changed = this.change.files.find((entry) => entry.path === filePath || entry.previousPath === filePath);
    if (!changed) {
      throw new Error(`Rule ${this.rule.binding.id} reported evidence outside the change set: ${filePath}`);
    }

    const identity = canonicalDigest({ path: changed.path, key: options.key });
    if (!options.key.trim() || this.#keys.has(identity)) {
      throw new Error(`Rule ${this.rule.binding.id} reported a duplicate or empty finding key: ${options.key}`);
    }
    this.#keys.add(identity);
    const beforePath = changed.previousPath ?? changed.path;
    const afterPath = changed.path;
    const line = options.startLine ?? 1;
    const endLine = options.endLine ?? line;
    const excerpt =
      options.excerpt ?? changed.after?.content?.split(/\r?\n/)[Math.max(0, line - 1)]?.trim() ?? options.message;
    const relatedFiles = [...new Set((options.relatedFiles ?? []).map(normalizeRepositoryPath))].toSorted();
    for (const related of relatedFiles) {
      if (!this.change.files.some((entry) => entry.path === related || entry.previousPath === related))
        throw new Error(`Rule ${this.rule.binding.id} reported related context outside the change set: ${related}`);
    }

    this.findings.push(
      new FindingRecord({
        selector: undefined,
        ruleId: this.rule.binding.id,
        lifecycle: "change",
        authority: this.rule.binding.authority,
        source: this.#sourceIdentity,
        fingerprint: fingerprintChange({
          before: null,
          after: options.evidence,
          beforePath,
          afterPath,
          operation: operation(changed),
          occurrence: options.key,
        }),
        lineageKey:
          options.lineageKey ??
          canonicalDigest({
            kind: "change-lineage",
            bindingId: this.rule.binding.id,
            path: afterPath,
            key: options.key,
          }),
        file: afterPath,
        line,
        column: 1,
        endLine,
        endColumn: 1,
        message: options.message,
        sourceSnippet: excerpt.length > 160 ? `${excerpt.slice(0, 157)}...` : excerpt,
        relatedFiles,
      }),
    );
  }
}
