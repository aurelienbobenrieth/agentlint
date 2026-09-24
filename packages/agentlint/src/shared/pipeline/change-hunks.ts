import type { ChangeHunk, ChangeLine } from "../../domain/rule/model.js";
import { textLines } from "../../domain/source-text.js";
import { Array as A, Schema } from "effect";

/**
 * A compact change fixture that cannot be normalized in memory.
 *
 * @since 0.2.0
 * @category Errors
 */
export class ChangeFixtureError extends Schema.TaggedError<ChangeFixtureError>()("agentlint/ChangeFixtureError", {
  reason: Schema.Literal("too_large"),
  lines: Schema.Struct({ before: Schema.Number, after: Schema.Number }),
}) {
  override get message(): string {
    return `Compact change fixture is too large (${this.lines.before} × ${this.lines.after} lines). Supply an explicit normalized ChangeSet.`;
  }
}

/**
 * Small in-memory fixtures use an exact line diff with the same three-line context as Git. Throws `ChangeFixtureError`
 * when the fixture is too large for the in-memory diff.
 */
export function fixtureHunks({
  before,
  after,
}: {
  readonly before: string | undefined;
  readonly after: string | undefined;
}): ChangeHunk[] {
  const oldLines = textLines(before);
  const newLines = textLines(after);
  const width = newLines.length + 1;
  if ((oldLines.length + 1) * width > 4_000_000) {
    throw new ChangeFixtureError({ reason: "too_large", lines: { before: oldLines.length, after: newLines.length } });
  }
  const lengths = new Uint32Array((oldLines.length + 1) * width);
  for (const oldIndex of oldLines.keys()) {
    const i = oldLines.length - oldIndex - 1;
    for (const newIndex of newLines.keys()) {
      const j = newLines.length - newIndex - 1;
      lengths[i * width + j] =
        oldLines[i] === newLines[j]
          ? 1 + (lengths[(i + 1) * width + j + 1] ?? 0)
          : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
    }
  }
  const lines: ChangeLine[] = [];
  const cursor = { old: 0, next: 0 };
  while (cursor.old < oldLines.length || cursor.next < newLines.length) {
    if (
      cursor.old < oldLines.length &&
      cursor.next < newLines.length &&
      oldLines[cursor.old] === newLines[cursor.next]
    ) {
      lines.push({ kind: "context", content: oldLines[cursor.old] ?? "" });
      cursor.old += 1;
      cursor.next += 1;
    } else if (
      cursor.old < oldLines.length &&
      (cursor.next === newLines.length ||
        (lengths[(cursor.old + 1) * width + cursor.next] ?? 0) >= (lengths[cursor.old * width + cursor.next + 1] ?? 0))
    ) {
      lines.push({ kind: "deletion", content: oldLines[cursor.old] ?? "" });
      cursor.old += 1;
    } else {
      lines.push({ kind: "addition", content: newLines[cursor.next] ?? "" });
      cursor.next += 1;
    }
  }
  const intervals: Array<{ start: number; end: number }> = [];
  for (const [index, line] of lines.entries()) {
    if (line.kind === "context") continue;
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length, index + 4);
    const previous = intervals.at(-1);
    if (previous && start <= previous.end) previous.end = end;
    else intervals.push({ start, end });
  }
  return A.map(intervals, ({ start, end }) => {
    const preceding = lines.slice(0, start);
    const hunkLines = lines.slice(start, end);
    const oldCount = hunkLines.filter((line) => line.kind !== "addition").length;
    const newCount = hunkLines.filter((line) => line.kind !== "deletion").length;
    return {
      oldStart: preceding.filter((line) => line.kind !== "addition").length + (oldCount ? 1 : 0),
      oldLines: oldCount,
      newStart: preceding.filter((line) => line.kind !== "deletion").length + (newCount ? 1 : 0),
      newLines: newCount,
      lines: hunkLines,
    };
  });
}
