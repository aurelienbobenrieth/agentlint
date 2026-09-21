import type { ChangeHunk, ChangeLine } from "../../domain/rule.js";
import { Array as A } from "effect";

/**
 * Git-style text lines: a terminal newline terminates the last line, rather than adding one.
 */
export function textLines(source: string | undefined): string[] {
  if (!source) return [];
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * Small in-memory fixtures use an exact line diff with the same three-line context as Git.
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
    throw new Error("Compact change fixture is too large. Supply an explicit normalized ChangeSet.");
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
