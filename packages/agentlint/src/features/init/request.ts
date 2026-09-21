/**
 * Initialization contracts. @module @since 0.2.0
 */
import { Schema } from "effect";

export class InitCommand extends Schema.TaggedClass<InitCommand>()("InitCommand", {
  presets: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class InitPresetError extends Schema.TaggedError<InitPresetError>()("agentlint/InitPresetError", {
  preset: Schema.String,
}) {
  override get message(): string {
    return `Invalid preset ${this.preset}. Use a package name followed by # and its exported preset name.`;
  }
}
export class InitResult extends Schema.TaggedClass<InitResult>()("InitResult", {
  created: Schema.Boolean,
  message: Schema.String,
}) {}
