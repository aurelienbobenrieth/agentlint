import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { isAuthorizedReviewRequest } from "./server.js";

const token = "a".repeat(64);
const origins = new Set(["http://localhost:4974"]);

function request(method: string, cookie?: string, origin?: string): Pick<IncomingMessage, "headers" | "method"> {
  return { method, headers: { cookie, origin } };
}

describe("review session authorization", () => {
  it("accepts a same-origin request with the session cookie", () => {
    expect(
      isAuthorizedReviewRequest(request("POST", `agentlint_review=${token}`, [...origins][0]), token, origins),
    ).toBe(true);
  });

  it("rejects requests without the session cookie", () => {
    expect(isAuthorizedReviewRequest(request("POST", undefined, [...origins][0]), token, origins)).toBe(false);
  });

  it("rejects cross-origin mutations even with the session cookie", () => {
    expect(
      isAuthorizedReviewRequest(
        request("POST", `agentlint_review=${token}`, "https://attacker.example"),
        token,
        origins,
      ),
    ).toBe(false);
  });

  it("allows authenticated state reads without an Origin header", () => {
    expect(isAuthorizedReviewRequest(request("GET", `agentlint_review=${token}`), token, origins)).toBe(true);
  });
});
