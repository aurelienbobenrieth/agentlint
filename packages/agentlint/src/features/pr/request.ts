/** Pull request review application contracts. @module @since 0.2.0 */

import { Schema } from "effect";
import { ReviewArtifact } from "../review/contract.js";

export class PrCommand extends Schema.TaggedClass<PrCommand>()("PrCommand", {
  number: Schema.Number,
  repo: Schema.UndefinedOr(Schema.String),
}) {}

export class PrResult extends Schema.TaggedClass<PrResult>()("PrResult", {
  repo: Schema.String,
  artifactId: Schema.Number,
  /** Absolute path of the extracted `agentlint-review.json`. */
  artifactPath: Schema.String,
  artifact: ReviewArtifact,
}) {}

/** @since 0.2.0 @category errors */
export class PrError extends Schema.TaggedError<PrError>()("agentlint/PrError", {
  reason: Schema.Literals(["gh_missing", "gh_failed", "no_artifact", "invalid_artifact"]),
  number: Schema.Number,
  repo: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    const target = this.repo ? `${this.repo}#${this.number}` : `#${this.number}`;
    switch (this.reason) {
      case "gh_missing":
        return "agentlint pr needs the GitHub CLI: install gh and run gh auth login";
      case "gh_failed":
        return `GitHub CLI failed for ${target}: ${this.detail}`;
      case "no_artifact":
        return `No agentlint-review-${this.number} artifact on ${target}: the action has not uploaded one, the run is still in progress, or the artifact expired`;
      case "invalid_artifact":
        return `The artifact for ${target} is not an agentlint review artifact: ${this.detail}`;
    }
  }
}
