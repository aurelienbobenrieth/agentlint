import { fetchUsers } from "../api/users";

// TODO: paginate this list before the org grows
export function UsersPage() {
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

export async function inviteSupportAdministrator(email: string) {
  return createUser({ email, role: "admin" });
}
