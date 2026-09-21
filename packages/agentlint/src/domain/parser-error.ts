import { Schema } from "effect";

/**
 * Raised when parsing fails — e.g. missing grammar, corrupt WASM, or
 * tree-sitter returning a null tree.
 *
 * @since 0.1.0
 * @category errors
 */
export class ParserError extends Schema.TaggedError<ParserError>()("agentlint/ParserError", {
  reason: Schema.Literals(["wasm_missing", "unknown_grammar", "init_failed", "load_failed", "parse_failed"]),
  grammar: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    switch (this.reason) {
      case "wasm_missing":
        return `WASM file not found: ${this.detail}`;
      case "unknown_grammar":
        return `Unknown grammar: ${this.grammar}`;
      case "init_failed":
        return `Parser failed to initialize${this.detail ? `: ${this.detail}` : ""}`;
      case "load_failed":
        return `Failed to load grammar ${this.grammar}: ${this.detail}`;
      case "parse_failed":
        return `Parse failed${this.grammar ? ` (${this.grammar})` : ""}: ${this.detail ?? "parser returned null tree"}`;
    }
  }
}
