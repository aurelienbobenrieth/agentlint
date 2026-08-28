/**
 * Removes the legacy_flag column, superseded by the roles table.
 */
export async function up(db: Database) {
  // Backfill added during review: copy any remaining legacy_flag holders into roles
  // before the column disappears, so no account silently loses access.
  await db.execute(`
    INSERT INTO user_roles (user_id, role)
    SELECT id, 'legacy' FROM users WHERE legacy_flag = true
    ON CONFLICT DO NOTHING
  `);
  await db.dropColumn("users", "legacy_flag");
}
