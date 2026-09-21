/**
 * Ephemeral localhost server for the packaged review SPA. @module @since 0.2.0
 */

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
  ReviewActionRequest,
  ReviewOpenRequest,
  type EditorApplication,
  type ReviewFinishResult,
  type ReviewMode,
  type ReviewStatePayload,
} from "./contract.js";
import { detectEditorApplications, openInEditor } from "./editor.js";
import {
  applyReviewAction,
  buildReviewPayload,
  findReviewFinding,
  isInsideDirectory,
  makeReviewSessionState,
} from "./handler.js";

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

const ActionDecoder = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewActionRequest));
const OpenRequestDecoder = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewOpenRequest));
const MAX_BODY_BYTES = 128 * 1024;
/**
 * Past the cap the body is drained so the client can read the 413. Past this the connection is dropped.
 */
const MAX_DRAINED_BYTES = 8 * MAX_BODY_BYTES;
const INVALID_SESSION = { ok: false, message: "Invalid review session." };
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

type Body =
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "too_large" }
  | { readonly status: "aborted" };

function readBody(request: IncomingMessage): Promise<Body> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DRAINED_BYTES) request.destroy();
      else if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () =>
      resolve(
        size > MAX_BODY_BYTES
          ? { status: "too_large" }
          : { status: "ok", text: Buffer.concat(chunks).toString("utf8") },
      ),
    );
    // A destroyed or reset request never ends. Settle anyway so nothing waits on it.
    request.on("close", () => resolve({ status: "aborted" }));
    request.on("error", () => resolve({ status: "aborted" }));
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

/**
 * Decode a JSON request body, or answer the request and return `undefined`. The schema failure stays out of the
 * response: it echoes the body and describes internal types.
 */
async function readJson<A>(
  request: IncomingMessage,
  response: ServerResponse,
  decode: (body: string) => A,
  invalid: string,
): Promise<A | undefined> {
  if (!/^application\/json\s*(;|$)/iu.test(request.headers["content-type"] ?? "")) {
    sendJson(response, 415, { ok: false, message: "Send the request as application/json." });
    return undefined;
  }
  const body = await readBody(request);
  if (body.status === "aborted") return undefined;
  if (body.status === "too_large") {
    sendJson(response, 413, { ok: false, message: "Request body exceeds 128 KiB." });
    return undefined;
  }
  try {
    return decode(body.text);
  } catch {
    sendJson(response, 400, { ok: false, message: invalid });
    return undefined;
  }
}

/**
 * What a request must present on one port. Cookies ignore ports, so the cookie name carries it: concurrent sessions
 * keep separate cookies and a browser never offers this one to another local server.
 */
export interface ReviewSessionGuard {
  readonly cookieName: string;
  readonly hosts: ReadonlySet<string>;
  readonly origins: ReadonlySet<string>;
}

export function reviewSessionGuard(port: number): ReviewSessionGuard {
  // A browser leaves the default port out of both headers.
  const hosts = ["127.0.0.1", "localhost"].flatMap((host) => [`${host}:${port}`, ...(port === 80 ? [host] : [])]);
  return {
    cookieName: `agentlint_review_${port}`,
    hosts: new Set(hosts),
    origins: new Set(hosts.map((host) => `http://${host}`)),
  };
}

function requestTokens(request: Pick<IncomingMessage, "headers">, cookieName: string): string[] {
  return (request.headers.cookie?.split(";") ?? []).flatMap((cookie) => {
    const [name, value] = cookie.trim().split("=", 2);
    return name === cookieName && value !== undefined ? [value] : [];
  });
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Another local page can set a same-named cookie on a narrower path, which a browser sends first. Any matching cookie
 * authenticates, so a planted one cannot shadow the real one.
 */
function hasSessionCookie(request: Pick<IncomingMessage, "headers">, guard: ReviewSessionGuard, token: string) {
  return requestTokens(request, guard.cookieName).some((candidate) => tokenMatches(candidate, token));
}

export function isAuthorizedReviewRequest(
  request: Pick<IncomingMessage, "headers" | "method">,
  expectedToken: string,
  guard: ReviewSessionGuard,
): boolean {
  if (!hasSessionCookie(request, guard, expectedToken)) return false;
  if (request.method !== "GET") return guard.origins.has(request.headers.origin ?? "");
  // A state read scans the repository. Browsers that send fetch metadata must show the read is ours.
  const site = request.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
}

function openBrowser(url: string, platform: string): void {
  const [command, args] =
    platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  execFile(command, args, { windowsHide: true }, () => undefined);
}

export interface ReviewSessionOptions {
  readonly rules?: ReadonlyArray<string>;
  readonly files?: ReadonlyArray<string>;
  readonly base?: string | undefined;
  readonly port: number;
  readonly open: boolean;
  readonly mode: ReviewMode;
  readonly artifact?: ReviewStatePayload | undefined;
}

export interface ReviewSessionSummary {
  readonly summary: string;
  readonly feedback: string;
}

export interface ReviewListenerConfig {
  readonly session: Pick<ReviewSessionOptions, "rules" | "files" | "base" | "mode" | "artifact">;
  readonly assetsRoot: string;
  readonly applications: ReadonlyArray<EditorApplication>;
  /**
   * Called once the finish response is written and no action is still writing to the repository.
   */
  readonly onFinish: (result: ReviewFinishResult) => void;
}

export interface ReviewListener {
  readonly handle: (request: IncomingMessage, response: ServerResponse) => void;
  /**
   * Single-use secret for the advertised URL. It is traded for the session cookie and never accepted again.
   */
  readonly bootstrapToken: string;
  /**
   * Settles when no review action is in flight.
   */
  readonly idle: () => Promise<void>;
}

/**
 * The request listener of one review session, independent of the socket it is mounted on.
 */
export const makeReviewListener = Effect.fn("makeReviewListener")(function* (config: ReviewListenerConfig) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services: Context.Context<ReviewServices> = yield* Effect.context<ReviewServices>();
  const run = <A, E>(effect: Effect.Effect<A, E, ReviewServices>): Promise<A> =>
    Effect.runPromise(Effect.provideContext(effect, services));
  const canonicalRepository = yield* fs.realPath(env.cwd);
  const { artifact, rules, files, base, mode } = config.session;
  const selection = { rules, files, base, mode };
  const root = config.assetsRoot;
  const index = path.resolve(root, "index.html");

  const sessionState = makeReviewSessionState();
  const bootstrapToken = randomBytes(32).toString("hex");
  const sessionToken = randomBytes(32).toString("hex");
  let bootstrapUsed = false;
  let finishing = false;
  let guard: (ReviewSessionGuard & { readonly port: number }) | undefined;
  const actionCounts = new Map<string, number>();
  const inFlight = new Set<Promise<unknown>>();

  const guardFor = (port: number) => (guard?.port === port ? guard : (guard = { port, ...reviewSessionGuard(port) }));
  const track = <A>(work: Promise<A>): Promise<A> => {
    const release = () => inFlight.delete(work);
    inFlight.add(work);
    work.then(release, release);
    return work;
  };
  const idle = (): Promise<void> => (inFlight.size === 0 ? Promise.resolve() : Promise.allSettled(inFlight).then(idle));
  const currentPayload = () =>
    run(
      buildReviewPayload({
        ...selection,
        transport: "attached",
        session: sessionState,
        applications: config.applications,
      }),
    );

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

  const respond = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      sendJson(response, 400, { ok: false, message: "Malformed request target." });
      return;
    }
    const session = guardFor(request.socket.localPort ?? 0);
    // A rebound DNS name reaches this socket with its own Host. Only the loopback names are ours.
    if (!session.hosts.has((request.headers.host ?? "").toLowerCase())) {
      sendJson(response, 403, { ok: false, message: "Invalid review host." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
      const fresh = !bootstrapUsed && tokenMatches(url.searchParams.get("token") ?? undefined, bootstrapToken);
      // A browser that already holds the session may revisit the spent link from its history.
      if (!fresh && !hasSessionCookie(request, session, sessionToken)) {
        response.writeHead(403, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
        response.end("This review link is invalid or was already used. Run agentlint review again.\n");
        return;
      }
      bootstrapUsed = true;
      response.writeHead(302, {
        "cache-control": "no-store",
        location: "/",
        "referrer-policy": "no-referrer",
        ...(fresh ? { "set-cookie": `${session.cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/` } : {}),
      });
      response.end();
      return;
    }

    if (url.pathname.startsWith("/api/") && !isAuthorizedReviewRequest(request, sessionToken, session)) {
      sendJson(response, 403, INVALID_SESSION);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      sendJson(response, 200, artifact ?? (await currentPayload()));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/action") {
      if (artifact) {
        sendJson(response, 409, { ok: false, message: "Detached review actions stay in the browser." });
        return;
      }
      const action = await readJson(request, response, ActionDecoder, "Invalid action request.");
      if (!action) return;
      if (finishing) {
        sendJson(response, 409, { ok: false, message: "The review is finishing." });
        return;
      }
      const result = await track(run(applyReviewAction(action, { ...selection, session: sessionState })));
      if (result.ok) actionCounts.set(action.type, (actionCounts.get(action.type) ?? 0) + 1);
      sendJson(response, result.ok ? 200 : 409, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/open") {
      if (artifact) {
        sendJson(response, 409, { ok: false, message: "Detached reviews cannot open local applications." });
        return;
      }
      const openRequest = await readJson(request, response, OpenRequestDecoder, "Invalid open request.");
      if (!openRequest) return;
      if (!config.applications.some(({ id }) => id === openRequest.application)) {
        sendJson(response, 409, { ok: false, message: "That application is not available." });
        return;
      }
      const finding = await run(findReviewFinding(openRequest.findingId, selection));
      if (!finding) {
        sendJson(response, 404, { ok: false, message: "The finding is no longer available." });
        return;
      }
      let canonicalFile: string;
      try {
        canonicalFile = await run(fs.realPath(path.resolve(env.cwd, finding.file)));
      } catch {
        sendJson(response, 404, { ok: false, message: "The finding file is no longer available." });
        return;
      }
      if (!isInsideDirectory(path, canonicalRepository, canonicalFile)) {
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
      // An action between its lock and its rename must land before the process is allowed to exit.
      finishing = true;
      await idle();
      const result: ReviewFinishResult = {
        ok: true,
        summary: summary(),
        feedback: feedbackOutput(),
      };
      sendJson(response, 200, result);
      config.onFinish(result);
      return;
    }

    if (request.method === "GET") {
      // The URL parser already resolved dot segments. The containment check is what keeps a file inside the UI.
      const candidate = path.resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
      const file = isInsideDirectory(path, root, candidate) ? candidate : index;
      const exists = await run(fs.exists(file).pipe(Effect.orElseSucceed(() => false)));
      const target = exists ? file : index;
      const bytes = await run(fs.readFile(target));
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
  };

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    respond(request, response).catch((error: unknown) => {
      // The detail names absolute paths and internal types. It belongs in the terminal, not in the browser.
      const detail = error instanceof Error ? error.message : String(error);
      const target = request.url?.split("?", 1)[0];
      run(Console.error(`agentlint review: ${request.method} ${target} failed: ${detail}`)).catch(() => undefined);
      try {
        if (response.headersSent) response.destroy();
        else {
          sendJson(response, 500, {
            ok: false,
            message: "The review server failed. See the terminal running agentlint review.",
          });
        }
      } catch {
        response.destroy();
      }
    });
  };

  return { handle, bootstrapToken, idle } satisfies ReviewListener;
});

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
  const applications = options.artifact
    ? []
    : yield* Effect.promise(() => detectEditorApplications(env.platform, undefined, env.cwd));

  const services: Context.Context<ReviewServices> = yield* Effect.context<ReviewServices>();
  let finished: ((result: ReviewFinishResult) => void) | undefined;
  const listener = yield* makeReviewListener({
    session: options,
    assetsRoot: root,
    applications,
    onFinish: (result) => finished?.(result),
  });

  return yield* Effect.callback<ReviewSessionSummary, ReviewServerError>((resume) => {
    const server = createServer(listener.handle);
    const stop = (): void => {
      server.close();
      server.closeAllConnections();
    };
    finished = (result) => {
      stop();
      resume(Effect.succeed(result));
    };

    server.on("error", (error) =>
      resume(Effect.fail(new ReviewServerError({ reason: "listen_failed", detail: error.message }))),
    );
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      // The socket is IPv4 loopback only. `localhost` may resolve to ::1, where someone else can listen.
      const reviewUrl = `http://127.0.0.1:${port}/?token=${listener.bootstrapToken}`;
      void Effect.runPromise(
        Effect.provideContext(Console.log(`agentlint review at ${reviewUrl} (Ctrl+C to abort)`), services),
      );
      if (options.open) openBrowser(reviewUrl, env.platform);
    });
    // An interrupted session must not leave an action between its lock and its rename either.
    return Effect.promise(async () => {
      stop();
      await listener.idle();
    });
  });
});
