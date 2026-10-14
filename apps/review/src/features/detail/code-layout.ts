export type CodeSegment = { readonly kind: "lines" | "gap"; readonly start: number; readonly end: number };
/**
 * Files up to 30 lines and files without highlights stay open. Longer files keep three context lines per range; gaps of
 * eight lines or fewer stay readable.
 */
export const codeSegments = ({
  length,
  ranges,
}: {
  readonly length: number;
  readonly ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>;
}): ReadonlyArray<CodeSegment> => {
  if (length === 0) return [];
  if (length <= 30 || ranges.length === 0) return [{ kind: "lines", start: 1, end: length }];
  const windows = ranges
    .map(({ start, end }) => ({
      start: Math.max(1, Math.min(length, start) - 3),
      end: Math.min(length, Math.max(start, end) + 3),
    }))
    .toSorted((a, b) => a.start - b.start);
  const segments: CodeSegment[] = [];
  let cursor = 1;
  for (const window of windows) {
    const previous = segments.at(-1);
    if (previous !== undefined && window.start <= previous.end + 9) {
      segments[segments.length - 1] = { ...previous, end: Math.max(previous.end, window.end) };
    } else {
      const start = window.start - cursor <= 8 ? cursor : window.start;
      if (start > cursor) segments.push({ kind: "gap", start: cursor, end: start - 1 });
      segments.push({ kind: "lines", start, end: window.end });
    }
    cursor = Math.max(cursor, window.end + 1);
  }
  const last = segments.at(-1);
  if (last !== undefined && cursor <= length) {
    if (length - cursor + 1 <= 8) segments[segments.length - 1] = { ...last, end: length };
    else segments.push({ kind: "gap", start: cursor, end: length });
  }
  return segments;
};
