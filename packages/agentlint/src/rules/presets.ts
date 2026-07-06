import { definePreset } from "../domain/config.js";
import { boundedQuery } from "./bounded-query.js";
import { queryStateCoverage } from "./query-state-coverage.js";

export const basePreset = definePreset({
  rules: {
    "data/bounded-query": boundedQuery,
  },
  files: ["**/*.{ts,tsx,js,jsx}"],
  ignores: ["**/*.test.*", "**/*.spec.*", "**/*.d.ts"],
});

export const frontendPreset = definePreset({
  extends: [basePreset],
  rules: {
    "ui/query-state-coverage": queryStateCoverage,
  },
  overrides: [
    {
      files: ["**/*.{tsx,jsx}"],
      rules: {
        "ui/query-state-coverage": "on",
      },
    },
    {
      files: ["**/*.test.*", "**/*.spec.*"],
      rules: {
        "ui/query-state-coverage": "off",
      },
    },
  ],
});
