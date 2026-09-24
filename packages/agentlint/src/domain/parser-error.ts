import { Schema } from "effect";

/**
 * Raised when parsing fails — e.g. missing grammar, corrupt WASM, or tree-sitter returning a null tree.
 *
 * @since 0.1.0
 * @category Errors
 */
export class ParserError extends Schema.TaggedError<ParserError>()("agentlint/ParserError", {
  reason: Schema.Literals(["wasm_missing", "unknown_grammar", "init_failed", "load_failed", "parse_failed"]),
  grammar: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return {
      wasm_missing: `WASM file not found: ${this.detail}`,
      unknown_grammar: `Unknown grammar: ${this.grammar}`,
      init_failed: `Parser failed to initialize${this.detail ? `: ${this.detail}` : ""}`,
      load_failed: `Failed to load grammar ${this.grammar}: ${this.detail}`,
      parse_failed: `Parse failed${this.grammar ? ` (${this.grammar})` : ""}: ${this.detail ?? "parser returned null tree"}`,
    }[this.reason];
  }
}
