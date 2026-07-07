/**
 * Removes the legacy_flag column, superseded by the roles table.
 * Backfill verified in 2026-06 - see the approved ledger entry.
 */
export async function up(db: Database) {
  await db.dropColumn("users", "legacy_flag");
}
