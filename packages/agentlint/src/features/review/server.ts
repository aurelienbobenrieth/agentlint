/**
 * Ephemeral localhost server for the packaged review SPA. @module @since 0.2.0
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Array as A, Console, Effect, FileSystem, Layer, ManagedRuntime, Match, Option, Path, Schema } from "effect";
import type { Context } from "effect";
import { Env } from "../../config/env.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git/service.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { ProposalStore } from "../../shared/infrastructure/proposal-store.js";
import {
  ReviewActionRequest,
  ReviewOpenRequest,
  type EditorApplication,
  type ReviewActionResult,
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
import {
  hasSessionCookie,
  isAuthorizedReviewRequest,
  reviewSessionGuard,
  tokenMatches,
  type ReviewSessionGuard,
} from "./server/auth.js";
import { readJson, sendJson } from "./server/http.js";

export { isAuthorizedReviewRequest, reviewSessionGuard } from "./server/auth.js";

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
  reason: Schema.Literals([
    "assets_missing",
    "listen_failed",
    "invalid_artifact",
    "editor_detection_failed",
    "shutdown_failed",
  ]),
  detail: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return {
      assets_missing: "Review UI assets are missing. Rebuild or reinstall agentlint.",
      invalid_artifact: `Invalid review artifact: ${this.detail}`,
      listen_failed: `Review server failed to listen: ${this.detail}`,
      editor_detection_failed: `Review editor detection failed: ${this.detail}`,
      shutdown_failed: `Review server shutdown failed: ${this.detail}`,
    }[this.reason];
  }
}

const ActionDecoder = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewActionRequest));
const OpenRequestDecoder = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewOpenRequest));
const INVALID_SESSION = { ok: false, message: "Invalid review session." };
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".woff2", "font/woff2"],
  [".map", "application/json"],
]);

function openBrowser({ url, platform }: { readonly url: string; readonly platform: string }): void {
  const [command, args] = Match.value(platform).pipe(
    Match.when("win32", () => ["cmd", ["/c", "start", "", url]] as const),
    Match.when("darwin", () => ["open", [url]] as const),
    Match.orElse(() => ["xdg-open", [url]] as const),
  );
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
  /**
   * Internal execution boundary used to coordinate the listener with its host and deterministic tests.
   */
  readonly executeAction?: ((proceed: () => Promise<ReviewActionResult>) => Promise<ReviewActionResult>) | undefined;
}

export interface ReviewListener {
  readonly handle: (input: { readonly request: IncomingMessage; readonly response: ServerResponse }) => void;
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
  const runtime = ManagedRuntime.make(Layer.succeedContext(services));
  const run = runtime.runPromise;
  const canonicalRepository = yield* fs.realPath(env.cwd);
  const { artifact, rules, files, base, mode } = config.session;
  const selection = { rules, files, base, mode };
  const root = config.assetsRoot;
  const index = path.resolve(root, "index.html");

  const sessionState = makeReviewSessionState();
  const bootstrapToken = randomBytes(32).toString("hex");
  const sessionToken = randomBytes(32).toString("hex");
  const mutable: {
    bootstrapUsed: boolean;
    finishing: boolean;
    guard: (ReviewSessionGuard & { readonly port: number }) | undefined;
  } = { bootstrapUsed: false, finishing: false, guard: undefined };
  const actionCounts = new Map<string, number>();
  const inFlight = new Set<Promise<unknown>>();

  const guardFor = (port: number) =>
    mutable.guard?.port === port ? mutable.guard : (mutable.guard = { port, ...reviewSessionGuard(port) });
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
    const parts = A.map([...actionCounts], ([action, count]) => `${count} ${action}`);
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

  const respond = async ({
    request,
    response,
  }: {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
  }): Promise<void> => {
    const url = (() => {
      try {
        return new URL(request.url ?? "/", "http://127.0.0.1");
      } catch {
        // REASON: malformed request targets are converted to the explicit 400 branch below.
        return undefined;
      }
    })();
    if (!url) {
      sendJson({ response, status: 400, payload: { ok: false, message: "Malformed request target." } });
      return;
    }
    const session = guardFor(request.socket.localPort ?? 0);
    // A rebound DNS name reaches this socket with its own Host. Only the loopback names are ours.
    if (!session.hosts.has((request.headers.host ?? "").toLowerCase())) {
      sendJson({ response, status: 403, payload: { ok: false, message: "Invalid review host." } });
      return;
    }

    if (request.method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
      const fresh =
        !mutable.bootstrapUsed &&
        tokenMatches({ actual: url.searchParams.get("token") ?? undefined, expected: bootstrapToken });
      // A browser that already holds the session may revisit the spent link from its history.
      if (!fresh && !hasSessionCookie({ request, guard: session, token: sessionToken })) {
        response.writeHead(403, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
        response.end("This review link is invalid or was already used. Run agentlint review again.\n");
        return;
      }
      mutable.bootstrapUsed = true;
      response.writeHead(302, {
        "cache-control": "no-store",
        location: "/",
        "referrer-policy": "no-referrer",
        ...(fresh ? { "set-cookie": `${session.cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/` } : {}),
      });
      response.end();
      return;
    }

    if (
      url.pathname.startsWith("/api/") &&
      !isAuthorizedReviewRequest({ request, expectedToken: sessionToken, guard: session })
    ) {
      sendJson({ response, status: 403, payload: INVALID_SESSION });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      sendJson({ response, status: 200, payload: artifact ?? (await currentPayload()) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/action") {
      if (artifact) {
        sendJson({
          response,
          status: 409,
          payload: { ok: false, message: "Detached review actions stay in the browser." },
        });
        return;
      }
      const action = await readJson({ request, response, decode: ActionDecoder, invalid: "Invalid action request." });
      if (!action) return;
      if (mutable.finishing) {
        sendJson({ response, status: 409, payload: { ok: false, message: "The review is finishing." } });
        return;
      }
      const proceed = () => run(applyReviewAction(action, { ...selection, session: sessionState }));
      const result = await track(config.executeAction ? config.executeAction(proceed) : proceed());
      if (result.ok) actionCounts.set(action.type, (actionCounts.get(action.type) ?? 0) + 1);
      sendJson({ response, status: result.ok ? 200 : 409, payload: result });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/open") {
      if (artifact) {
        sendJson({
          response,
          status: 409,
          payload: { ok: false, message: "Detached reviews cannot open local applications." },
        });
        return;
      }
      const openRequest = await readJson({
        request,
        response,
        decode: OpenRequestDecoder,
        invalid: "Invalid open request.",
      });
      if (!openRequest) return;
      if (!config.applications.some(({ id }) => id === openRequest.application)) {
        sendJson({ response, status: 409, payload: { ok: false, message: "That application is not available." } });
        return;
      }
      const finding = await run(findReviewFinding(openRequest.findingId, selection));
      if (!finding) {
        sendJson({ response, status: 404, payload: { ok: false, message: "The finding is no longer available." } });
        return;
      }
      const canonicalFile = await run(fs.realPath(path.resolve(env.cwd, finding.file))).catch(() => {
        // REASON: an unavailable finding file is represented by the stable 404 response below.
        return undefined;
      });
      if (!canonicalFile) {
        sendJson({
          response,
          status: 404,
          payload: { ok: false, message: "The finding file is no longer available." },
        });
        return;
      }
      if (!isInsideDirectory({ path, directory: canonicalRepository, target: canonicalFile })) {
        sendJson({
          response,
          status: 409,
          payload: { ok: false, message: "The finding file is outside the repository." },
        });
        return;
      }
      try {
        await openInEditor({
          application: openRequest.application,
          platform: env.platform,
          file: canonicalFile,
          line: finding.line,
          column: finding.column,
        });
        sendJson({ response, status: 200, payload: { ok: true, message: `Opened in ${openRequest.application}.` } });
      } catch (error) {
        // REASON: launcher details stay server-side; clients receive a stable editor failure.
        const detail = Schema.is(Schema.instanceOf(Error))(error) ? error.message : String(error);
        run(
          Console.error(`agentlint review: ${openRequest.application} could not open ${finding.file}: ${detail}`),
        ).catch(() => undefined);
        sendJson({
          response,
          status: 409,
          payload: { ok: false, message: "The application could not open this file." },
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/finish") {
      // An action between its lock and its rename must land before the process is allowed to exit.
      mutable.finishing = true;
      await idle();
      const result: ReviewFinishResult = {
        ok: true,
        summary: summary(),
        feedback: feedbackOutput(),
      };
      sendJson({ response, status: 200, payload: result });
      config.onFinish(result);
      return;
    }

    if (request.method === "GET") {
      // The URL parser already resolved dot segments. The containment check is what keeps a file inside the UI.
      const candidate = path.resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
      const file = isInsideDirectory({ path, directory: root, target: candidate }) ? candidate : index;
      const exists = await run(fs.exists(file).pipe(Effect.orElseSucceed(() => false)));
      const target = exists ? file : index;
      const bytes = await run(fs.readFile(target));
      const extension = target.slice(target.lastIndexOf("."));
      response.writeHead(200, {
        "cache-control": extension === ".html" ? "no-store" : "public, max-age=31536000, immutable",
        "content-security-policy":
          "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "content-type": MIME_TYPES.get(extension) ?? "application/octet-stream",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
      response.end(Buffer.from(bytes));
      return;
    }

    sendJson({ response, status: 404, payload: { ok: false, message: "Not found" } });
  };

  const handle = ({
    request,
    response,
  }: {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
  }): void => {
    respond({ request, response }).catch((error) => {
      // The detail names absolute paths and internal types. It belongs in the terminal, not in the browser.
      const detail = Schema.is(Schema.instanceOf(Error))(error) ? error.message : "Unknown request failure";
      const target = request.url?.split("?", 1)[0];
      run(Console.error(`agentlint review: ${request.method} ${target} failed: ${detail}`)).catch(() => {
        // REASON: failure to write the terminal diagnostic cannot change the HTTP recovery path.
        return undefined;
      });
      try {
        if (response.headersSent) response.destroy();
        else {
          sendJson({
            response,
            status: 500,
            payload: {
              ok: false,
              message: "The review server failed. See the terminal running agentlint review.",
            },
          });
        }
      } catch {
        // REASON: the response is already failing; destroying the socket is the final recovery action.
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
  const candidates = [path.resolve(import.meta.dirname, "ui"), path.resolve(import.meta.dirname, "..", "dist", "ui")];
  const availableAssets = yield* Effect.filter(
    candidates,
    (candidate) => fs.exists(path.resolve(candidate, "index.html")).pipe(Effect.orElseSucceed(() => false)),
    { concurrency: 1 },
  );
  const rootOption = A.head(availableAssets);
  if (Option.isNone(rootOption)) return yield* new ReviewServerError({ reason: "assets_missing" });
  const root = rootOption.value;
  const applications = options.artifact
    ? []
    : yield* Effect.tryPromise({
        try: () => detectEditorApplications({ platform: env.platform, repository: env.cwd }),
        catch: (cause) =>
          new ReviewServerError({ reason: "editor_detection_failed", detail: "Editor detection failed", cause }),
      });

  const terminal = yield* Console.Console;
  const completion: { finish: ((result: ReviewFinishResult) => void) | undefined } = { finish: undefined };
  const listener = yield* makeReviewListener({
    session: options,
    assetsRoot: root,
    applications,
    onFinish: (result) => completion.finish?.(result),
  });

  return yield* Effect.callback<ReviewSessionSummary, ReviewServerError>((resume) => {
    const server = createServer((request, response) => listener.handle({ request, response }));
    const stop = (): void => {
      server.close();
      server.closeAllConnections();
    };
    completion.finish = (result) => {
      stop();
      resume(Effect.succeed(result));
    };

    server.on("error", (error) =>
      resume(Effect.fail(new ReviewServerError({ reason: "listen_failed", detail: error.message }))),
    );
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      const port = address !== null && !Schema.is(Schema.String)(address) ? address.port : options.port;
      // The socket is IPv4 loopback only. `localhost` may resolve to ::1, where someone else can listen.
      const reviewUrl = `http://127.0.0.1:${port}/?token=${listener.bootstrapToken}`;
      terminal.log(`agentlint review at ${reviewUrl} (Ctrl+C to abort)`);
      if (options.open) openBrowser({ url: reviewUrl, platform: env.platform });
    });
    // An interrupted session must not leave an action between its lock and its rename either.
    return Effect.tryPromise({
      try: async () => {
        stop();
        await listener.idle();
      },
      catch: (cause) => new ReviewServerError({ reason: "shutdown_failed", detail: "Review shutdown failed", cause }),
    }).pipe(Effect.ignore({ log: true }));
  });
});
