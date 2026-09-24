/**
 * Local review-session authentication. @module
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Array as A } from "effect";

/**
 * Port-scoped cookie and request origins for one review session.
 */
export interface ReviewSessionGuard {
  readonly cookieName: string;
  readonly hosts: ReadonlySet<string>;
  readonly origins: ReadonlySet<string>;
}

export function reviewSessionGuard(port: number): ReviewSessionGuard {
  const hosts = A.flatMap(["127.0.0.1", "localhost"], (host) => [`${host}:${port}`, ...(port === 80 ? [host] : [])]);
  return {
    cookieName: `agentlint_review_${port}`,
    hosts: new Set(hosts),
    origins: new Set(A.map(hosts, (host) => `http://${host}`)),
  };
}

function requestTokens({
  request,
  cookieName,
}: {
  readonly request: Pick<IncomingMessage, "headers">;
  readonly cookieName: string;
}): string[] {
  return (request.headers.cookie?.split(";") ?? []).flatMap((cookie) => {
    const [name, value] = cookie.trim().split("=", 2);
    return name === cookieName && value !== undefined ? [value] : [];
  });
}

export function tokenMatches({
  actual,
  expected,
}: {
  readonly actual: string | undefined;
  readonly expected: string;
}): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function hasSessionCookie({
  request,
  guard,
  token,
}: {
  readonly request: Pick<IncomingMessage, "headers">;
  readonly guard: ReviewSessionGuard;
  readonly token: string;
}): boolean {
  return requestTokens({ request, cookieName: guard.cookieName }).some((candidate) =>
    tokenMatches({ actual: candidate, expected: token }),
  );
}

export function isAuthorizedReviewRequest({
  request,
  expectedToken,
  guard,
}: {
  readonly request: Pick<IncomingMessage, "headers" | "method">;
  readonly expectedToken: string;
  readonly guard: ReviewSessionGuard;
}): boolean {
  if (!hasSessionCookie({ request, guard, token: expectedToken })) return false;
  if (request.method !== "GET") return guard.origins.has(request.headers.origin ?? "");
  const site = request.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
}
