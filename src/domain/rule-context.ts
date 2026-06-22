/**
 * Rule context - the interface rules use to report findings.
 *
 * @module
 * @since 0.2.0
 */

import { fnv1a7 } from "./hash.js";
import { type FindingOptions, FindingRecord } from "./finding.js";

export interface RuleContext {
  getFilename(): string;
  getFilePath(): string;
  getSourceCode(): string;
  getLinesAround(line: number, radius?: number): string;
  report(options: FindingOptions): void;
}

export class RuleContextImpl implements RuleContext {
  readonly ruleId: string;
  readonly findings: FindingRecord[] = [];

  #absolutePath = "";
  #file = "";
  #source = "";

  constructor(ruleId: string) {
    this.ruleId = ruleId;
  }

  setFile(absolutePath: string, file: string, source: string): void {
    this.#absolutePath = absolutePath;
    this.#file = file.replace(/\\/g, "/");
    this.#source = source;
  }

  drainFindings(): FindingRecord[] {
    return this.findings.splice(0);
  }

  getFilename(): string {
    return this.#absolutePath;
  }

  getFilePath(): string {
    return this.#file;
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

  report(options: FindingOptions): void {
    const line = options.node.startPosition.row + 1;
    const column = options.node.startPosition.column + 1;
    const sourceLines = this.#source.split("\n");
    const rawLine = sourceLines[line - 1] ?? "";
    const nodeSnippet = options.node.text.split("\n")[0]?.trim() ?? "";
    const rawSnippet = nodeSnippet.length > 0 ? nodeSnippet : rawLine.trim();
    const sourceSnippet = rawSnippet.length > 100 ? rawSnippet.slice(0, 97) + "..." : rawSnippet;
    const normalizedNodeText = options.node.text.replace(/\s+/g, " ").trim();

    const hash = fnv1a7(`${this.ruleId}:${this.#file}:${options.node.type}:${normalizedNodeText}:${options.message}`);

    this.findings.push(
      new FindingRecord({
        selector: undefined,
        ruleId: this.ruleId,
        file: this.#file,
        absolutePath: this.#absolutePath,
        nodeType: options.node.type,
        line,
        column,
        message: options.message,
        sourceSnippet,
        hash,
      }),
    );
  }
}
