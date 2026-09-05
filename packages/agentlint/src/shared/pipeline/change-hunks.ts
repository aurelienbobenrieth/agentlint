import type { ChangeHunk, ChangeLine } from "../../domain/rule.js";

/** Git-style text lines: a terminal newline terminates the last line, rather than adding one. */
export function textLines(source: string | undefined): string[] {
  if (!source) return [];
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Small in-memory fixtures use an exact line diff with the same three-line context as Git. */
export function fixtureHunks(before: string | undefined, after: string | undefined): ChangeHunk[] {
  const oldLines = textLines(before);
  const newLines = textLines(after);
  const width = newLines.length + 1;
  if ((oldLines.length + 1) * width > 4_000_000) {
    throw new Error("Compact change fixture is too large. Supply an explicit normalized ChangeSet.");
  }
  const lengths = new Uint32Array((oldLines.length + 1) * width);
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        oldLines[i] === newLines[j]
          ? 1 + (lengths[(i + 1) * width + j + 1] ?? 0)
          : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
    }
  }
  const lines: ChangeLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      lines.push({ kind: "context", content: oldLines[i++] ?? "" });
      j++;
    } else if (
      i < oldLines.length &&
      (j === newLines.length || (lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0))
    ) {
      lines.push({ kind: "deletion", content: oldLines[i++] ?? "" });
    } else lines.push({ kind: "addition", content: newLines[j++] ?? "" });
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
  return intervals.map(({ start, end }) => {
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
