// @ts-check
/**
 * Unified-diff parsing for the pull request files endpoint. A review comment can
 * only be attached to a RIGHT-side line that appears in a hunk, so the action
 * computes that set from each file's `patch` before it creates inline comments.
 */

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Right-side line numbers present in the hunks of one patch: added lines and
 * context lines. Deleted lines only exist on the LEFT side.
 *
 * @param {string | undefined} patch
 * @returns {Set<number>}
 */
export function commentableLines(patch) {
  /** @type {Set<number>} */
  const lines = new Set();
  if (!patch) return lines;
  let right = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      right = Number(header[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("-")) continue;
    if (line.startsWith("+") || line.startsWith(" ") || line === "") {
      lines.add(right);
      right += 1;
    }
  }
  return lines;
}

/**
 * @typedef {object} PullFile
 * @property {string} filename
 * @property {string} [patch]
 * @property {string} [status]
 */

/**
 * Map of file path to commentable right-side lines for every file in the pull
 * request. Files without a patch (binary, too large, renamed without changes)
 * are present with an empty set so callers can still tell "in the PR" from
 * "not in the PR".
 *
 * @param {ReadonlyArray<PullFile>} files
 * @returns {Map<string, Set<number>>}
 */
export function commentableByFile(files) {
  /** @type {Map<string, Set<number>>} */
  const map = new Map();
  for (const file of files) {
    if (file.status === "removed") continue;
    map.set(file.filename, commentableLines(file.patch));
  }
  return map;
}

/**
 * @param {Map<string, Set<number>>} commentable
 * @param {{ file: string, line: number }} location
 */
export function isCommentable(commentable, location) {
  return commentable.get(location.file)?.has(location.line) ?? false;
}
