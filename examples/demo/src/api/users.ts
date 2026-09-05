export async function fetchUsers(): Promise<User[]> {
  const response = await fetch("/api/users");
  return response.json();
}

export async function listActiveUsers(db: Database): Promise<User[]> {
  return db.users.findMany({ where: { active: true } });
}
