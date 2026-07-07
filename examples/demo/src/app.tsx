export function Users() {
  const query = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  if (!query.data) return null;
  return (
    <ul>
      {query.data.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}

export async function migrate(db: Database) {
  await db.dropTable("legacy_users");
}
