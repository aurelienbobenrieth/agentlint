import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { isAuthorizedReviewRequest, reviewSessionGuard } from "./server.js";

const token = "a".repeat(64);
const guard = reviewSessionGuard(4974);
const origin = "http://localhost:4974";
const cookie = `agentlint_review_4974=${token}`;

function request({
  method,
  headers,
}: {
  readonly method: string;
  readonly headers: { cookie?: string; origin?: string; "sec-fetch-site"?: string };
}): Pick<IncomingMessage, "headers" | "method"> {
  return { method, headers };
}

describe("review session authorization", () => {
  it("accepts a same-origin request with the session cookie", () => {
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "POST", headers: { cookie, origin } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(true);
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "POST", headers: { cookie, origin: "http://127.0.0.1:4974" } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(true);
  });

  it("rejects requests without the session cookie", () => {
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "POST", headers: { origin } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(false);
  });

  it("rejects cross-origin mutations even with the session cookie", () => {
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "POST", headers: { cookie, origin: "https://attacker.example" } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(false);
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "POST", headers: { cookie, origin: "http://localhost:4975" } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(false);
  });

  it("allows authenticated state reads without an Origin header", () => {
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "GET", headers: { cookie } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(true);
  });

  it("rejects state reads that fetch metadata attributes to another site", () => {
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "GET", headers: { cookie, "sec-fetch-site": "cross-site" } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(false);
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "GET", headers: { cookie, "sec-fetch-site": "same-origin" } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(true);
  });

  it("names the cookie after the port, so another session's cookie does not authenticate", () => {
    const other = `agentlint_review_4975=${token}`;
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "GET", headers: { cookie: other } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(false);
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "GET", headers: { cookie: `agentlint_review=${token}` } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(false);
  });

  it("finds the session cookie behind a planted one with the same name", () => {
    const planted = `agentlint_review_4974=planted; ${cookie}`;
    expect(
      isAuthorizedReviewRequest({
        request: request({ method: "GET", headers: { cookie: planted } }),
        expectedToken: token,
        guard,
      }),
    ).toBe(true);
  });

  it("leaves the default port out of the accepted hosts and origins", () => {
    expect([...reviewSessionGuard(80).origins]).toContain("http://127.0.0.1");
    expect([...guard.hosts]).toEqual(["127.0.0.1:4974", "localhost:4974"]);
  });
});
