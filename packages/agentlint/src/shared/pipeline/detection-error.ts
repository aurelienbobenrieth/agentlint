import { Schema } from "effect";

export class DetectionError extends Schema.TaggedError<DetectionError>()("agentlint/DetectionError", {
  ruleId: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Rule ${this.ruleId} failed: ${detail}`;
  }
}

/**
 * Every file of one scan whose syntax is incomplete or unsupported by its grammar. The scan is incomplete, so the gate
 * stays closed; listing them together saves one run per broken file.
 */
export class UnparseableFilesError extends Schema.TaggedError<UnparseableFilesError>()(
  "agentlint/UnparseableFilesError",
  {
    reason: Schema.Literal("parse_failed"),
    files: Schema.Array(Schema.Struct({ file: Schema.String, grammar: Schema.String })),
  },
) {
  override get message(): string {
    const listed = this.files.map(({ file, grammar }) => `  ${file} (${grammar})`).join("\n");
    return `Parse failed: syntax is incomplete or unsupported by the grammar in ${this.files.length} file${this.files.length === 1 ? "" : "s"}:\n${listed}`;
  }
}
