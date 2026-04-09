/**
 * Rule context — the interface rules use to interact with the runner.
 *
 * Provides file metadata, source access, and the {@link RuleContext.flag}
 * method for recording matches.
 *
 * @module
 * @since 0.1.0
 */

import { fnv1a7 } from "./hash.js";
import { type FlagOptions, FlagRecord } from "./flag.js";

/**
 * Context object passed to `createOnce`. Available throughout the rule's lifecycle.
 *
 * @since 0.1.0
 * @category models
 */
export interface RuleContext {
  /** Absolute path of the current file being analyzed. */
  getFilename(): string;
  /** Full source content of the current file. */
  getSourceCode(): string;
  /**
   * Lines around the given 1-based line number, formatted with line numbers.
   * @param line 1-based line number
   * @param radius number of lines above/below to include (default 10)
   */
  getLinesAround(line: number, radius?: number): string;
  /** Record a match for the output report. */
  flag(options: FlagOptions): void;
}

/**
 * Internal implementation of {@link RuleContext}.
 *
 * Tracks the current file, accumulates flags, and provides source
 * access helpers. The check command calls {@link setFile} before each
 * file and {@link drainFlags} after the tree walk to collect results.
 *
 * @since 0.1.0
 * @category internals
 */
export class RuleContextImpl implements RuleContext {
  readonly ruleName: string;
  readonly flags: FlagRecord[] = [];

  #filename = "";
  #source = "";

  constructor(ruleName: string) {
    this.ruleName = ruleName;
  }

  /**
   * Set the current file context. Called by the check command before
   * each file is walked.
   */
  setFile(filename: string, source: string): void {
    this.#filename = filename;
    this.#source = source;
  }

  /**
   * Remove and return all accumulated flags. Called after the tree
   * walk for each file to collect results.
   */
  drainFlags(): FlagRecord[] {
    return this.flags.splice(0);
  }

  getFilename(): string {
    return this.#filename;
  }

  getSourceCode(): string {
    return this.#source;
  }

  getLinesAround(line: number, radius = 10): string {
    const lines = this.#source.split("\n");
    const start = Math.max(0, line - 1 - radius);
    const end = Math.min(lines.length, line + radius);
    return lines
      .slice(start, end)
      .map((l, i) => `${String(start + i + 1).padStart(4)} | ${l}`)
      .join("\n");
  }

  flag(options: FlagOptions): void {
    const line = options.node.startPosition.row + 1;
    const col = options.node.startPosition.column + 1;
    const sourceLines = this.#source.split("\n");
    const rawLine = sourceLines[line - 1] ?? "";
    const trimmed = rawLine.trim();
    const sourceSnippet = trimmed.length > 100 ? trimmed.slice(0, 97) + "..." : trimmed;

    const hash = fnv1a7(`${this.ruleName}:${this.#filename}:${line}:${col}:${options.message}`);

    this.flags.push(
      new FlagRecord({
        ruleName: this.ruleName,
        filename: this.#filename,
        line,
        col,
        message: options.message,
        sourceSnippet,
        hash,
        instruction: options.instruction,
        suggest: options.suggest,
      }),
    );
  }
}
