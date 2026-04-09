// This is a sample file for testing
import { readFile } from "node:fs/promises";

// Increment the counter
const x = 1;

/** Fetches user data from the API */
export function getUser(id: number): string {
  return `user-${id}`;
}

// Helper function
export const fetchUser = (id: number) => {
  return getUser(id);
};

function internalHelper() {
  // TODO: implement later
  return null;
}
