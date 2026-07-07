---
name: drop-column-backfill
description: Always verify backfill row counts before dropping a column or table
triggers:
  files: ["src/migrations/**"]
  grep: "dropColumn|dropTable"
---

The 2026-06 legacy_flag removal shipped a week late because the backfill had
silently skipped rows with NULL org_id. Before any destructive migration:

1. `SELECT count(*)` on both sides with the same predicate set.
2. Run the migration against the staging snapshot first.
3. Keep the down() path executable for one release cycle.
