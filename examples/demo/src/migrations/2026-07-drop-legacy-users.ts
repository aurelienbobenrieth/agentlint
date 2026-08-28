/**
 * Drops the legacy_users table now that users_v2 is the source of truth.
 */
export async function up(db: Database) {
  await db.dropTable("legacy_users", { cascade: true, lockTimeoutMs: 7_500 });
}
