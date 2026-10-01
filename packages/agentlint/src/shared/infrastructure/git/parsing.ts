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

const C_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
};

/**
 * Undo Git's C-style path quoting: `"` delimiters, backslash escapes, and octal bytes (`core.quotePath` writes
 * non-ASCII bytes that way). Answers the unquoted text and the rest of the input after the closing quote.
 */
function unquoteCStyle(input: string): { readonly value: string; readonly rest: string } | undefined {
  if (!input.startsWith('"')) return undefined;
  const bytes: number[] = [];
  let index = 1;
  while (index < input.length) {
    const character = input[index] ?? "";
    if (character === '"') {
      return { value: Buffer.from(bytes).toString("utf8"), rest: input.slice(index + 1) };
    }
    if (character !== "\\") {
      bytes.push(...Buffer.from(character, "utf8"));
      index += 1;
      continue;
    }
    const next = input[index + 1] ?? "";
    const octal = /^[0-3][0-7]{2}/.exec(input.slice(index + 1, index + 4))?.[0];
    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      index += 4;
      continue;
    }
    const escaped = C_ESCAPES[next];
    if (escaped === undefined) return undefined;
    bytes.push(escaped);
    index += 2;
  }
  return undefined;
}

/**
 * The path of a `diff --git a/<path> b/<path>` header when both sides name the same path, as they always do without
 * rename or copy detection. Both names are quoted, or neither is.
 */
function patchHeaderPath(header: string): string | undefined {
  const names = header.slice("diff --git ".length);
  const quoted = unquoteCStyle(names);
  if (quoted) return quoted.value.startsWith("a/") ? quoted.value.slice(2) : undefined;
  // `a/<path> b/<path>`: the two halves have the same length.
  const length = (names.length - "a/ b/".length) / 2;
  if (!Number.isInteger(length) || length < 1 || !names.startsWith("a/")) return undefined;
  const path = names.slice(2, 2 + length);
  return names === `a/${path} b/${path}` ? path : undefined;
}

/**
 * Split the output of one `git diff --no-renames --src-prefix=a/ --dst-prefix=b/` run into its per-file patches, in
 * output order. A path can own two patches (a type change is a deletion and an addition).
 */
export function splitPatches(output: string): ReadonlyArray<{ readonly path: string; readonly patch: string }> {
  const patches: Array<{ path: string; patch: string }> = [];
  // Content lines carry a one-character marker, so only a header starts a line with `diff --git `.
  const starts = [...output.matchAll(/^diff --git [^\n]*$/gm)];
  for (const [position, match] of starts.entries()) {
    const path = patchHeaderPath(match[0].replace(/\r$/, ""));
    const end = starts[position + 1]?.index ?? output.length;
    if (path !== undefined) patches.push({ path, patch: output.slice(match.index, end) });
  }
  return patches;
}
