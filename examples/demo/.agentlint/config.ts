import { defineConfig, defineRule, frontendPreset } from "@aurelienbbn/agentlint";

const lossyMigration = defineRule({
  id: "danger/lossy-migration",
  description: "Flags schema operations that can destroy data.",
  guidance: {
    standard: "Destructive schema operations require an explicit human sign-off.",
    checks: [
      "Dropping tables or columns must be intentional, and reversible or backed up.",
      "Renames disguised as drop-and-recreate count as destructive.",
    ],
    examples: [
      {
        label: "Migrate then drop",
        bad: 'db.dropTable("users_old"); // data not verified copied',
        good: 'await verifyBackfill("users_v2"); db.dropTable("users_old");',
      },
    ],
  },
  match: [
    {
      pattern: "$DB.dropTable($$$ARGS)",
      message: "dropTable on $DB destroys data and needs human approval.",
    },
  ],
  fixtures: {
    invalid: ["db.dropTable('users');"],
    valid: ["db.createTable('users');"],
  },
});

export default defineConfig({
  extends: [frontendPreset],
  rules: {
    "danger/lossy-migration": lossyMigration,
  },
  policy: {
    "danger/lossy-migration": { persistence: "durable", resolution: "human" },
  },
  files: ["src/**/*.{ts,tsx}"],
  notes: { dirs: [".agents/learn"] },
});
