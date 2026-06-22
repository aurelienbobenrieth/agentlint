/**
 * Guidance data contracts and normalization helpers.
 *
 * Guidance is the contextual standard attached to a rule. The default check
 * output uses only the compact standard; `explain` can print checks, examples,
 * and refs on demand.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";

export const GuidanceRef = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("skill"),
    id: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("url"),
    href: Schema.String,
  }),
]);

export type GuidanceRef = Schema.Schema.Type<typeof GuidanceRef>;

export const GuidanceExample = Schema.Struct({
  label: Schema.optional(Schema.String),
  bad: Schema.optional(Schema.String),
  good: Schema.optional(Schema.String),
});

export type GuidanceExample = Schema.Schema.Type<typeof GuidanceExample>;

export const GuidanceObject = Schema.Struct({
  standard: Schema.String,
  checks: Schema.optional(Schema.Array(Schema.String)),
  examples: Schema.optional(Schema.Array(GuidanceExample)),
  refs: Schema.optional(Schema.Array(GuidanceRef)),
});

export type GuidanceObject = Schema.Schema.Type<typeof GuidanceObject>;

export const Guidance = Schema.Union([Schema.String, GuidanceObject]);

export type Guidance = Schema.Schema.Type<typeof Guidance>;

export interface NormalizedGuidance {
  readonly standard: string;
  readonly checks: ReadonlyArray<string>;
  readonly examples: ReadonlyArray<GuidanceExample>;
  readonly refs: ReadonlyArray<GuidanceRef>;
}

export function normalizeGuidance(guidance: Guidance): NormalizedGuidance {
  if (typeof guidance === "string") {
    return {
      standard: guidance.trim(),
      checks: [],
      examples: [],
      refs: [],
    };
  }

  return {
    standard: guidance.standard.trim(),
    checks: guidance.checks ?? [],
    examples: guidance.examples ?? [],
    refs: guidance.refs ?? [],
  };
}

export function compactStandard(guidance: Guidance): string {
  const normalized = normalizeGuidance(guidance);
  const firstLine = normalized.standard
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ?? normalized.standard;
}
