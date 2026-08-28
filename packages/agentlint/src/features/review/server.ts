/** Ephemeral localhost server for the packaged review SPA. @module @since 0.2.0 */

import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import type { Context } from "effect";
import { Env } from "../../config/env.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { ProposalStore } from "../../shared/infrastructure/proposal-store.js";
import {
  ReviewAction,
  ReviewOpenRequest,
  type ReviewFinishResult,
  type ReviewMode,
  type ReviewStatePayload,
} from "./contract.js";
import { detectEditorApplications, openInEditor } from "./editor.js";
import { applyReviewAction, buildReviewPayload, makeReviewSessionState } from "./handler.js";

type ReviewServices =
  | Env
  | FileSystem.FileSystem
  | Path.Path
  | ConfigLoader
  | Git
  | AcceptanceStore
  | ProposalStore
  | Parser;

export class ReviewServerError extends Schema.TaggedError<ReviewServerError>()("agentlint/ReviewServerError", {
  reason: Schema.Literals(["assets_missing", "listen_failed", "invalid_artifact"]),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    switch (this.reason) {
      case "assets_missing":
        return "Review UI assets are missing. Rebuild or reinstall agentlint.";
      case "invalid_artifact":
        return `Invalid review artifact: ${this.detail}`;
      case "listen_failed":
        return `Review server failed to listen: ${this.detail}`;
    }
  }
}

const ActionDecoder = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewAction));
const OpenRequestDecoder = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewOpenRequest));
const MAX_BODY_BYTES = 128 * 1024;
const SESSION_COOKIE = "agentlint_review";
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
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body exceeds 128 KiB."));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function requestToken(request: IncomingMessage): string | undefined {
  for (const cookie of request.headers.cookie?.split(";") ?? []) {
    const [name, value] = cookie.trim().split("=", 2);
    if (name === SESSION_COOKIE) return value;
  }
  return undefined;
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function isAuthorizedReviewRequest(
  request: Pick<IncomingMessage, "headers" | "method">,
  expectedToken: string,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  return (
    tokenMatches(requestToken(request as IncomingMessage), expectedToken) &&
    (request.method === "GET" || allowedOrigins.has(request.headers.origin ?? ""))
  );
}

export function openBrowser(url: string, platform: string): void {
  const [command, args] =
    platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  execFile(command, args, { windowsHide: true }, () => undefined);
}

export interface ReviewSessionOptions {
  readonly base?: string | undefined;
  readonly port: number;
  readonly open: boolean;
  readonly mode: ReviewMode;
  readonly artifact?: ReviewStatePayload | undefined;
  readonly artifactSource?: string | undefined;
}

export interface ReviewSessionSummary {
  readonly summary: string;
  readonly feedback: string;
  readonly acceptanceOutput: string;
}

export const runReviewSession = Effect.fn("runReviewSession")(function* (options: ReviewSessionOptions) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const candidates = [
    path.resolve(import.meta.dirname ?? ".", "ui"),
    path.resolve(import.meta.dirname ?? ".", "..", "dist", "ui"),
  ];
  let assetsRoot: string | undefined;
  for (const candidate of candidates) {
    if (yield* fs.exists(path.resolve(candidate, "index.html")).pipe(Effect.orElseSucceed(() => false))) {
      assetsRoot = candidate;
      break;
    }
  }
  if (!assetsRoot) return yield* new ReviewServerError({ reason: "assets_missing" });

  const root = assetsRoot;
  const sessionState = makeReviewSessionState();
  const sessionToken = randomBytes(32).toString("hex");
  const actionCounts = new Map<string, number>();
  let allowedOrigins = new Set<string>();
  const services: Context.Context<ReviewServices> = yield* Effect.context<ReviewServices>();
  const runInContext = <A, E>(effect: Effect.Effect<A, E, ReviewServices>): Promise<A> =>
    Effect.runPromise(Effect.provideContext(effect, services));
  const applications = options.artifact ? [] : yield* Effect.promise(() => detectEditorApplications(env.platform));
  const canonicalRepository = yield* fs.realPath(env.cwd);

  const summary = (): string => {
    const parts = [...actionCounts].map(([action, count]) => `${count} ${action}`);
    if (sessionState.feedback.length) parts.push(`${sessionState.feedback.length} change request(s)`);
    if (sessionState.calibration.length) parts.push(`${sessionState.calibration.length} calibration note(s)`);
    return parts.length ? parts.join(", ") : "no actions recorded";
  };
  const feedbackOutput = (): string => {
    if (sessionState.feedback.length) {
      return [
        "Apply this agentlint review feedback:",
        "",
        ...sessionState.feedback.map((item) => `- ${item.ruleId} at ${item.file}:${item.line}: ${item.comment}`),
      ].join("\n");
    }
    if (sessionState.calibration.length) {
      return [
        "Use this agentlint calibration feedback to refine the detector:",
        "",
        ...sessionState.calibration.map(
          (item) => `- ${item.ruleId} at ${item.file}: ${item.classification}${item.note ? `. ${item.note}` : ""}`,
        ),
      ].join("\n");
    }
    return "";
  };

  return yield* Effect.callback<ReviewSessionSummary, ReviewServerError>((resume) => {
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://localhost");
        try {
          if (request.method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
            if (!tokenMatches(url.searchParams.get("token") ?? undefined, sessionToken)) {
              sendJson(response, 403, { ok: false, message: "Invalid review session." });
              return;
            }
            response.writeHead(302, {
              "cache-control": "no-store",
              location: "/",
              "set-cookie": `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
            });
            response.end();
            return;
          }

          if (url.pathname.startsWith("/api/") && !isAuthorizedReviewRequest(request, sessionToken, allowedOrigins)) {
            sendJson(response, 403, { ok: false, message: "Invalid review session." });
            return;
          }

          if (request.method === "GET" && url.pathname === "/api/state") {
            const payload =
              options.artifact ??
              (await runInContext(
                buildReviewPayload({
                  base: options.base,
                  mode: options.mode,
                  transport: "attached",
                  session: sessionState,
                  applications,
                }),
              ));
            sendJson(response, 200, payload);
            return;
          }

          if (request.method === "POST" && url.pathname === "/api/action") {
            if (options.artifact) {
              sendJson(response, 409, { ok: false, message: "Detached review actions stay in the browser." });
              return;
            }
            const action = ActionDecoder(await readBody(request));
            const result = await runInContext(
              applyReviewAction(action, { base: options.base, mode: options.mode, session: sessionState }),
            );
            if (result.ok) actionCounts.set(action.type, (actionCounts.get(action.type) ?? 0) + 1);
            sendJson(response, result.ok ? 200 : 409, result);
            return;
          }

          if (request.method === "POST" && url.pathname === "/api/open") {
            if (options.artifact) {
              sendJson(response, 409, { ok: false, message: "Detached reviews cannot open local applications." });
              return;
            }
            let openRequest: ReviewOpenRequest;
            try {
              openRequest = OpenRequestDecoder(await readBody(request));
            } catch {
              sendJson(response, 400, { ok: false, message: "Invalid open request." });
              return;
            }
            if (!applications.some(({ id }) => id === openRequest.application)) {
              sendJson(response, 409, { ok: false, message: "That application is not available." });
              return;
            }
            const payload = await runInContext(
              buildReviewPayload({
                base: options.base,
                mode: options.mode,
                transport: "attached",
                session: sessionState,
                applications,
              }),
            );
            const finding = payload.findings.find(({ id }) => id === openRequest.findingId);
            if (!finding?.editor) {
              sendJson(response, 404, { ok: false, message: "The finding is no longer available." });
              return;
            }
            const absoluteFile = path.resolve(env.cwd, finding.file);
            let canonicalFile: string;
            try {
              canonicalFile = await runInContext(fs.realPath(absoluteFile));
            } catch {
              sendJson(response, 404, { ok: false, message: "The finding file is no longer available." });
              return;
            }
            const relative = path.relative(canonicalRepository, canonicalFile);
            const isInsideRepository =
              relative !== ".." &&
              !relative.startsWith("../") &&
              !relative.startsWith("..\\") &&
              !path.isAbsolute(relative);
            if (!isInsideRepository) {
              sendJson(response, 409, { ok: false, message: "The finding file is outside the repository." });
              return;
            }
            try {
              await openInEditor(openRequest.application, env.platform, canonicalFile, finding.line, finding.column);
              sendJson(response, 200, { ok: true, message: `Opened in ${openRequest.application}.` });
            } catch {
              sendJson(response, 409, { ok: false, message: "The application could not open this file." });
            }
            return;
          }

          if (request.method === "POST" && url.pathname === "/api/finish") {
            const result: ReviewFinishResult = {
              ok: true,
              summary: summary(),
              feedback: feedbackOutput(),
              acceptanceOutput: "",
            };
            sendJson(response, 200, result);
            server.close();
            server.closeAllConnections();
            resume(Effect.succeed(result));
            return;
          }

          if (request.method === "GET") {
            const requested = url.pathname === "/" ? "/index.html" : url.pathname;
            const candidate = path.resolve(root, `.${requested.replaceAll("..", "")}`);
            const relative = path.relative(root, candidate);
            const isInsideRoot =
              relative !== ".." &&
              !relative.startsWith("../") &&
              !relative.startsWith("..\\") &&
              !path.isAbsolute(relative);
            const file = isInsideRoot ? candidate : path.resolve(root, "index.html");
            const exists = await runInContext(fs.exists(file).pipe(Effect.orElseSucceed(() => false)));
            const target = exists ? file : path.resolve(root, "index.html");
            const bytes = await runInContext(fs.readFile(target));
            const extension = target.slice(target.lastIndexOf("."));
            response.writeHead(200, {
              "cache-control": extension === ".html" ? "no-store" : "public, max-age=31536000, immutable",
              "content-security-policy":
                "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
              "content-type": MIME_TYPES[extension] ?? "application/octet-stream",
              "referrer-policy": "no-referrer",
              "x-content-type-options": "nosniff",
            });
            response.end(Buffer.from(bytes));
            return;
          }

          sendJson(response, 404, { ok: false, message: "Not found" });
        } catch (error) {
          sendJson(response, 500, { ok: false, message: error instanceof Error ? error.message : String(error) });
        }
      })();
    });

    server.on("error", (error) =>
      resume(Effect.fail(new ReviewServerError({ reason: "listen_failed", detail: error.message }))),
    );
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
      const reviewUrl = `http://localhost:${port}/?token=${sessionToken}`;
      void runInContext(Console.log(`agentlint review at ${reviewUrl} (Ctrl+C to abort)`));
      if (options.open) openBrowser(reviewUrl, env.platform);
    });
    return Effect.sync(() => server.close());
  });
});
