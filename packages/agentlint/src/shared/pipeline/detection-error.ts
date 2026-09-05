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
