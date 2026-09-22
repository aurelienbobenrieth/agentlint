import { createHash } from "node:crypto";
import { fixtureHunks } from "./change-hunks.js";
import type { ChangeFixture, ChangeSet, ChangedFile } from "../../domain/rule/model.js";
import { normalizeLineEndings } from "../../domain/source-text.js";

/**
 * Same normalization and digest as the Git change source, so fixture snapshots match real evidence.
 */
function snapshot(source: string): { readonly content: string; readonly digest: string } {
  const content = normalizeLineEndings(source);
  return { content, digest: createHash("sha256").update(content).digest("hex") };
}

/**
 * Normalize a compact before-and-after fixture to the public change contract.
 */
export function normalizeChangeFixture(fixture: ChangeFixture): ChangeSet {
  if ("change" in fixture) return fixture.change;
  const before = fixture.before ?? {};
  const after = fixture.after ?? {};
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].toSorted();
  const files: ChangedFile[] = [];
  for (const path of paths) {
    const oldContent = before[path];
    const newContent = after[path];
    if (oldContent === newContent) continue;
    const status = oldContent === undefined ? "added" : newContent === undefined ? "deleted" : "modified";
    files.push({
      status,
      path: path.replace(/\\/g, "/"),
      before: oldContent === undefined ? null : snapshot(oldContent),
      after: newContent === undefined ? null : snapshot(newContent),
      hunks: fixtureHunks({ before: oldContent, after: newContent }),
    });
  }
  return { baseline: { kind: "git", ref: "fixture" }, files };
}
