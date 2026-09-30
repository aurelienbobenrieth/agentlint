/**
 * How far a scan got, for a caller that shows it while waiting. @module
 */

import { Context } from "effect";

export interface ScanProgressReporter {
  /**
   * State rules are about to analyze `files` files.
   */
  readonly analyzing: (files: number) => void;
  /**
   * One more of those files was analyzed.
   */
  readonly analyzed: () => void;
  /**
   * Change rules are reading the comparison with the baseline.
   */
  readonly comparing: () => void;
}

/**
 * Receives scan progress. Nothing listens unless a caller provides a reporter.
 */
export const ScanProgress = Context.Reference<ScanProgressReporter>("agentlint/ScanProgress", {
  defaultValue: () => ({ analyzing: () => undefined, analyzed: () => undefined, comparing: () => undefined }),
});
