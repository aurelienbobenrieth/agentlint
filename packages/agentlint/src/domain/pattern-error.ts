import { Schema } from "effect";

/**
 * Raised when a `match` definition cannot be compiled for a grammar — a pattern that does not parse, or a malformed
 * tree-sitter query.
 *
 * @since 0.2.0
 * @category Errors
 */
export class PatternError extends Schema.TaggedError<PatternError>()("agentlint/PatternError", {
  ruleId: Schema.String,
  reason: Schema.Literals(["pattern_parse", "query_invalid", "unsupported_frontend", "unknown_fixture_grammar"]),
  grammar: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return {
      pattern_parse: `Rule ${this.ruleId}: pattern does not parse as ${this.grammar}: ${this.detail}`,
      query_invalid: `Rule ${this.ruleId}: invalid tree-sitter query: ${this.detail}`,
      unsupported_frontend: `Rule ${this.ruleId}: "query" matches are not supported for the ${this.grammar} frontend`,
      unknown_fixture_grammar: `Rule ${this.ruleId}: no grammar registered for fixture file "${this.detail}"`,
    }[this.reason];
  }
}
