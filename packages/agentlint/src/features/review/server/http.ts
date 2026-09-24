/**
 * Bounded JSON request and response helpers for the local review server. @module
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { encodeJson } from "../../../shared/infrastructure/json.js";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_DRAINED_BYTES = 8 * MAX_BODY_BYTES;

type Body =
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "too_large" }
  | { readonly status: "aborted" };

function readBody(request: IncomingMessage): Promise<Body> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const body = { size: 0 };
    request.on("data", (chunk: Buffer) => {
      body.size += chunk.length;
      if (body.size > MAX_DRAINED_BYTES) request.destroy();
      else if (body.size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () =>
      resolve(
        body.size > MAX_BODY_BYTES
          ? { status: "too_large" }
          : { status: "ok", text: Buffer.concat(chunks).toString("utf8") },
      ),
    );
    request.on("close", () => resolve({ status: "aborted" }));
    request.on("error", () => resolve({ status: "aborted" }));
  });
}

export function sendJson({
  response,
  status,
  payload,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly payload: unknown;
}): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(encodeJson(payload));
}

export async function readJson<A>({
  request,
  response,
  decode,
  invalid,
}: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly decode: (body: string) => A;
  readonly invalid: string;
}): Promise<A | undefined> {
  if (!/^application\/json\s*(;|$)/iu.test(request.headers["content-type"] ?? "")) {
    sendJson({ response, status: 415, payload: { ok: false, message: "Send the request as application/json." } });
    return undefined;
  }
  const body = await readBody(request);
  if (body.status === "aborted") return undefined;
  if (body.status === "too_large") {
    sendJson({ response, status: 413, payload: { ok: false, message: "Request body exceeds 128 KiB." } });
    return undefined;
  }
  try {
    return decode(body.text);
  } catch {
    sendJson({ response, status: 400, payload: { ok: false, message: invalid } });
    return undefined;
  }
}
