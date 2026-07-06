/**
 * Local review server.
 *
 * Serves the built review SPA from `dist/ui` plus a small JSON API, then
 * blocks until the reviewer clicks "Finish review" (or the process is
 * interrupted). Uses `node:http` directly: the server is ephemeral,
 * single-user, and localhost-only, so a router layer would be pure
 * overhead.
 *
 * @module
 * @since 0.2.0
 */

import { Console, Effect, FileSystem, Path, Schema } from "effect";
import type { Context } from "effect";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exec } from "node:child_process";
import { Env } from "../../config/env.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { NotesStore } from "../../shared/infrastructure/notes-store.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { ReviewAction, type ReviewFinishResult } from "./contract.js";
import { applyReviewAction, buildReviewPayload, writeReviewFeedback, type ReviewFeedback } from "./handler.js";

/** Services the review session needs at runtime. */
type ReviewServices = Env | FileSystem.FileSystem | Path.Path | ConfigLoader | Git | LedgerStore | NotesStore | Parser;

export class ReviewServerError extends Schema.TaggedErrorClass<ReviewServerError>()("agentlint/ReviewServerError", {
  reason: Schema.Literals(["assets_missing", "listen_failed"]),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return this.reason === "assets_missing"
      ? "Review UI assets not found. Rebuild the package (pnpm build) or reinstall agentlint."
      : `Review server failed to listen: ${this.detail}`;
  }
}

const ActionDecoder = Schema.decodeUnknownSync(ReviewAction);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(body);
}

/**
 * Open a URL in the default browser, best effort.
 *
 * @since 0.2.0
 */
export function openBrowser(url: string, platform: string): void {
  const command =
    platform === "win32" ? `start "" "${url}"` : platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, () => {
    // Failure to open a browser is not an error - the URL is printed.
  });
}

export interface ReviewSessionOptions {
  readonly base: string | undefined;
  readonly port: number;
  readonly open: boolean;
}

export interface ReviewSessionSummary {
  readonly summary: string;
  readonly feedbackPath: string | null;
  readonly feedback: ReadonlyArray<ReviewFeedback>;
}

/**
 * Run a review session: start the server, optionally open the browser, and
 * resolve when the reviewer finishes.
 *
 * @since 0.2.0
 */
export const runReviewSession = Effect.fn("runReviewSession")(function* (options: ReviewSessionOptions) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // The SPA is built into dist/ui next to the compiled CLI entry.
  const candidates = [
    path.resolve(import.meta.dirname ?? ".", "ui"),
    path.resolve(import.meta.dirname ?? ".", "..", "dist", "ui"),
  ];
  let uiDir: string | undefined;
  for (const candidate of candidates) {
    if (yield* fs.exists(path.resolve(candidate, "index.html")).pipe(Effect.orElseSucceed(() => false))) {
      uiDir = candidate;
      break;
    }
  }
  if (!uiDir) {
    return yield* new ReviewServerError({ reason: "assets_missing" });
  }
  const assetsRoot = uiDir;

  const feedback: ReviewFeedback[] = [];
  const actionCounts = new Map<string, number>();

  // Node's request callbacks run outside the fiber, so capture the live
  // services once and provide them to every effect executed from a callback.
  const services: Context.Context<ReviewServices> = yield* Effect.context<ReviewServices>();
  const runInContext = <A, E>(effect: Effect.Effect<A, E, ReviewServices>): Promise<A> =>
    Effect.runPromise(Effect.provideContext(effect, services));

  const summaryText = (): string => {
    const parts = [...actionCounts.entries()].map(([type, count]) => `${count} ${type}`);
    if (feedback.length > 0) parts.push(`${feedback.length} change request(s)`);
    return parts.length > 0 ? parts.join(", ") : "no actions recorded";
  };

  const session = yield* Effect.callback<ReviewSessionSummary, ReviewServerError>((resume) => {
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://localhost");

        try {
          if (url.pathname === "/api/state" && request.method === "GET") {
            const payload = await runInContext(buildReviewPayload(options.base));
            sendJson(response, 200, payload);
            return;
          }

          if (url.pathname === "/api/action" && request.method === "POST") {
            const action = ActionDecoder(JSON.parse(await readBody(request)));
            const result = await runInContext(applyReviewAction(action, feedback));
            if (result.ok) {
              actionCounts.set(action.type, (actionCounts.get(action.type) ?? 0) + 1);
            }
            sendJson(response, result.ok ? 200 : 409, result);
            return;
          }

          if (url.pathname === "/api/finish" && request.method === "POST") {
            const feedbackPath = await runInContext(writeReviewFeedback(feedback));
            const result: ReviewFinishResult = { ok: true, summary: summaryText(), feedbackPath };
            sendJson(response, 200, result);
            server.close();
            resume(Effect.succeed({ summary: summaryText(), feedbackPath, feedback: [...feedback] }));
            return;
          }

          if (request.method === "GET") {
            // Static assets with an SPA fallback to index.html.
            const requested = url.pathname === "/" ? "/index.html" : url.pathname;
            const safePath = path.resolve(assetsRoot, "." + requested.replace(/\.\./g, ""));
            const extension = safePath.slice(safePath.lastIndexOf("."));
            const filePath = safePath.startsWith(assetsRoot) ? safePath : path.resolve(assetsRoot, "index.html");

            const content = await runInContext(
              Effect.gen(function* () {
                const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
                const target = exists ? filePath : path.resolve(assetsRoot, "index.html");
                return {
                  bytes: yield* fs.readFile(target).pipe(Effect.orElseSucceed(() => new Uint8Array())),
                  mime: exists ? (MIME_TYPES[extension] ?? "application/octet-stream") : "text/html; charset=utf-8",
                };
              }),
            );

            response.writeHead(200, { "content-type": content.mime });
            response.end(Buffer.from(content.bytes));
            return;
          }

          sendJson(response, 404, { ok: false, message: "Not found" });
        } catch (error) {
          sendJson(response, 500, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });

    server.on("error", (error) => {
      resume(Effect.fail(new ReviewServerError({ reason: "listen_failed", detail: error.message })));
    });

    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      const reviewUrl = `http://localhost:${port}`;

      void runInContext(Console.log(`agentlint review at ${reviewUrl} (Ctrl+C to abort)`));
      if (options.open) openBrowser(reviewUrl, env.platform);
    });

    return Effect.sync(() => {
      server.close();
    });
  });

  return session;
});
