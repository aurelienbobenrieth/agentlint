import { listActiveUsers } from "../api/users";

it.only("lists active users", async () => {
  const users = await listActiveUsers(fakeDb);
  expect(users).toHaveLength(2);
});

it("excludes deactivated users", async () => {
  const users = await listActiveUsers(fakeDb);
  expect(users.every((user) => user.active)).toBe(true);
});
