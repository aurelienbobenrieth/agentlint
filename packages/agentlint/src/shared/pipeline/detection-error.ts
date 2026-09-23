import { Predicate, Schema } from "effect";
import { DetectorContractError } from "../../domain/rule/model.js";

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

/**
 * A `--rule` selector that names no configured binding.
 */
export class UnknownBindingError extends Schema.TaggedError<UnknownBindingError>()("agentlint/UnknownBindingError", {
  bindingId: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `Unknown binding "${this.bindingId}". Configured bindings: ${this.available.join(", ") || "none"}`;
  }
}

/**
 * Detector hooks are synchronous. A promise-returning hook would report after the engine drained its findings, so the
 * finding would vanish and the gate would open; refuse it instead. Returns the value for use in expressions.
 */
export function synchronousHook<A>({
  ruleId,
  hook,
  value,
}: {
  readonly ruleId: string;
  readonly hook: string;
  readonly value: A;
}): A {
  if (Predicate.isPromiseLike(value)) {
    // The failure is reported here; do not let the abandoned promise surface as an unhandled rejection.
    Promise.resolve(value).catch(() => undefined);
    throw new DetectorContractError({ ruleId, reason: "async_hook", detail: hook });
  }
  return value;
}
