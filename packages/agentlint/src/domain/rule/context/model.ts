/**
 * Public state detector context. @module @since 0.2.0
 */

import type { FindingOptions } from "../../finding.js";

export interface RuleContext {
  /**
   * Absolute filesystem path of the current file.
   */
  readonly absolutePath: string;
  /**
   * Repository-relative, forward-slash path of the current file.
   */
  readonly path: string;
  /**
   * Full source text of the current file.
   */
  readonly source: string;
  /**
   * Explicit repository-relative binding dependencies, captured before detection.
   */
  readonly dependencies: Readonly<Record<string, string>>;
  report(options: FindingOptions): void;
}
