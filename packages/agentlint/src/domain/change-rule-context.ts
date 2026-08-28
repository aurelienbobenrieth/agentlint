/** Change detector context and finding construction. @module @since 0.2.0 */

import { canonicalDigest, fingerprintChange, normalizeRepositoryPath } from "./fingerprint.js";
import { FindingRecord } from "./finding.js";
import type { ChangeFindingOptions, ChangeRule, ChangeRuleContext, ChangeSet, ChangedFile } from "./rule.js";
import { findingSourceForRule } from "./rule-identity.js";

function operation(file: ChangedFile): "add" | "delete" | "modify" | "rename" {
  switch (file.status) {
    case "added":
      return "add";
    case "deleted":
      return "delete";
    case "renamed":
      return "rename";
    case "modified":
      return "modify";
  }
}

export class ChangeRuleContextImpl implements ChangeRuleContext {
  readonly change: ChangeSet;
  readonly findings: FindingRecord[] = [];

  constructor(
    readonly rule: ChangeRule,
    change: ChangeSet,
    private readonly absolutePath: (file: string) => string,
  ) {
    this.change = change;
  }

  report(options: ChangeFindingOptions): void {
    const filePath = normalizeRepositoryPath(options.file);
    const changed = this.change.files.find((entry) => entry.path === filePath || entry.previousPath === filePath);
    if (!changed) {
      throw new Error(`Rule ${this.rule.binding.id} reported evidence outside the change set: ${filePath}`);
    }

    const beforePath = changed.previousPath ?? changed.path;
    const afterPath = changed.path;
    const line = options.startLine ?? 1;
    const endLine = options.endLine ?? line;
    const excerpt =
      options.excerpt ?? changed.after?.content?.split(/\r?\n/)[Math.max(0, line - 1)]?.trim() ?? options.message;

    this.findings.push(
      new FindingRecord({
        selector: undefined,
        ruleId: this.rule.binding.id,
        lifecycle: "change",
        authority: this.rule.binding.authority,
        source: findingSourceForRule(this.rule),
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
        absolutePath: this.absolutePath(afterPath),
        line,
        column: 1,
        endLine,
        endColumn: 1,
        message: options.message,
        sourceSnippet: excerpt.length > 160 ? `${excerpt.slice(0, 157)}...` : excerpt,
      }),
    );
  }
}
