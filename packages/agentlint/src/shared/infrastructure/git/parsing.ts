/**
 * Parsers for deterministic Git status and unified-diff output. @module
 */

import { Match } from "effect";
import type { ChangeHunk, ChangeLine, ChangedFile } from "../../../domain/rule/model.js";

export interface StatusEntry {
  readonly status: ChangedFile["status"];
  readonly path: string;
  readonly previousPath?: string | undefined;
  readonly beforeMode: string;
  readonly afterMode: string;
  readonly beforeBlob: string;
}

export function parseGitRawStatus(output: string): ReadonlyArray<StatusEntry> {
  const tokens = output.split("\0").filter((token) => token.length > 0);
  const files: StatusEntry[] = [];
  const cursor = { index: 0 };
  while (cursor.index < tokens.length) {
    const header = /^:(\d{6}) (\d{6}) ([0-9a-f]+) [0-9a-f]+ ([A-Z])/.exec(tokens[cursor.index++] ?? "");
    if (!header) continue;
    const [, beforeMode = "", afterMode = "", beforeBlob = "", kind] = header;
    if (kind === "R" || kind === "C") {
      const previousPath = tokens[cursor.index++];
      const path = tokens[cursor.index++];
      if (previousPath && path)
        files.push({ status: "renamed", previousPath, path, beforeMode, afterMode, beforeBlob });
      continue;
    }
    const path = tokens[cursor.index++];
    if (!path) continue;
    const status: ChangedFile["status"] = Match.value(kind).pipe(
      Match.when("A", () => "added" as const),
      Match.when("D", () => "deleted" as const),
      Match.orElse(() => "modified" as const),
    );
    files.push({ status, path, beforeMode, afterMode, beforeBlob });
  }
  return files;
}

export function parseUnifiedHunks(output: string): ReadonlyArray<ChangeHunk> {
  const hunks: ChangeHunk[] = [];
  const state: {
    current: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: ChangeLine[] } | null;
  } = { current: null };
  for (const line of output.split(/\r?\n/)) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      if (state.current) hunks.push(state.current);
      state.current = {
        oldStart: Number(header[1]),
        oldLines: Number(header[2] ?? "1"),
        newStart: Number(header[3]),
        newLines: Number(header[4] ?? "1"),
        lines: [],
      };
      continue;
    }
    if (!state.current || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) state.current.lines.push({ kind: "addition", content: line.slice(1) });
    else if (line.startsWith("-")) state.current.lines.push({ kind: "deletion", content: line.slice(1) });
    else if (line.startsWith(" ")) state.current.lines.push({ kind: "context", content: line.slice(1) });
  }
  if (state.current) hunks.push(state.current);
  return hunks;
}
