// @ts-check
/**
 * Unified-diff parsing for the pull request files endpoint. A review comment can only be attached to a RIGHT-side line
 * that appears in a hunk, so the action computes that set from each file's `patch` before it creates inline comments.
 */

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Right-side line numbers present in the hunks of one patch: added lines and context lines. Deleted lines only exist on
 * the LEFT side.
 *
 * @param {string | undefined} patch
 * @returns {Set<number>}
 */
export function commentableLines(patch) {
  /**
   * @type {Set<number>}
   */
  const lines = new Set();
  if (!patch) return lines;
  /**
   * @param {{ remaining: string[]; right: number; inHunk: boolean }} input
   */
  const visit = ({ remaining, right, inHunk }) => {
    const [line, ...rest] = remaining;
    if (line === undefined) return;
    const header = HUNK_HEADER.exec(line);
    if (header) {
      visit({ remaining: rest, right: Number(header[1]), inHunk: true });
      return;
    }
    if (!inHunk || line.startsWith("\\") || line.startsWith("-")) {
      visit({ remaining: rest, right, inHunk });
      return;
    }
    if (line.startsWith("+") || line.startsWith(" ") || line === "") {
      lines.add(right);
      visit({ remaining: rest, right: right + 1, inHunk });
      return;
    }
    visit({ remaining: rest, right, inHunk });
  };
  visit({ remaining: patch.split("\n"), right: 0, inHunk: false });
  return lines;
}

/**
 * @typedef {object} PullFile
 * @property {string} filename
 * @property {string} [patch]
 * @property {string} [status]
 */

/**
 * Map of file path to commentable right-side lines for every file in the pull request. Files without a patch (binary,
 * too large, renamed without changes) are present with an empty set so callers can still tell "in the PR" from "not in
 * the PR".
 *
 * @param {ReadonlyArray<PullFile>} files
 * @returns {Map<string, Set<number>>}
 */
export function commentableByFile(files) {
  /**
   * @type {Map<string, Set<number>>}
   */
  const map = new Map();
  for (const file of files) {
    if (file.status === "removed") continue;
    map.set(file.filename, commentableLines(file.patch));
  }
  return map;
}

/**
 * @param {object} input
 * @param {Map<string, Set<number>>} input.commentable
 * @param {{ file: string; line: number }} input.location
 */
export function isCommentable({ commentable, location }) {
  return commentable.get(location.file)?.has(location.line) ?? false;
}
