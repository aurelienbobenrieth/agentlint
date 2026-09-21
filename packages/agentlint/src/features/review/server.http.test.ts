import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Env } from "../../config/env.js";
import { normalizeConfig } from "../../domain/config.js";
import { defineRule } from "../../domain/rule.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { ProposalStore } from "../../shared/infrastructure/proposal-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { ReviewActionResult, ReviewStatePayload, type ReviewFinishResult } from "./contract.js";
import { makeReviewListener, type ReviewListener, type ReviewListenerConfig } from "./server.js";

const sandbox = join(tmpdir(), "agentlint-v02-review-http-test");
const cwd = join(sandbox, "repository");
const assetsRoot = join(sandbox, "assets", "ui");
const rule = defineRule({
  lifecycle: "state",
  standard: { id: "security/danger", revision: 1, title: "Danger is reviewed", guidance: "Review danger calls." },
  detector: {
    id: "typescript/danger-call",
    version: 1,
    match: { pattern: "danger($$$ARGS)", message: "danger needs judgment" },
  },
  binding: { id: "security/danger", authority: "agent", include: ["src/**/*.ts"] },
});
const TestLayer = Layer.mergeAll(
  Layer.succeed(ConfigLoader, ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig({ rules: [rule] })) })),
  Layer.succeed(
    Git,
    Git.of({
      detectDefaultBranch: () => Effect.succeed("main"),
      changedFiles: () => Effect.succeed([]),
      changeSet: () => Effect.succeed({ baseline: { kind: "git", ref: "main" }, files: [] }),
    }),
  ),
  Parser.layer,
  AcceptanceStore.layer,
  ProposalStore.layer,
  SelectorCache.layer,
).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(
    Layer.succeed(
      Env,
      Env.of({
        cwd,
        argv: [],
        actor: "human:test",
        platform: "test",
        noColor: true,
        isTTY: false,
        setExitCode: () => {},
      }),
    ),
  ),
);

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewStatePayload));
const decodeResult = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewActionResult));

interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let runtime: ManagedRuntime.ManagedRuntime<Layer.Success<typeof TestLayer>, never>;
let server: Server;
let listener: ReviewListener;
let port: number;
let finished: ReviewFinishResult[];
let lockfilesAtFinish: string[];

async function mount(session: ReviewListenerConfig["session"] = { mode: "review" }): Promise<void> {
  listener = await runtime.runPromise(
    makeReviewListener({
      session,
      assetsRoot,
      applications: [],
      onFinish: (result) => {
        finished.push(result);
        lockfilesAtFinish = readdirSync(join(cwd, ".agentlint")).filter((name) => /\.(lock|tmp)$/u.test(name));
      },
    }),
  );
  server = createServer(listener.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
}

/** Raw client: unlike `fetch`, it sends the path and the headers exactly as written. */
function send(
  method: string,
  path: string,
  options: { readonly headers?: Record<string, string>; readonly body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: "127.0.0.1", port, method, path, headers: options.headers, agent: false },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

async function signIn(): Promise<string> {
  const reply = await send("GET", `/?token=${listener.bootstrapToken}`);
  const cookie = reply.headers["set-cookie"]?.[0]?.split(";")[0];
  if (reply.status !== 302 || !cookie) throw new Error(`Sign-in failed with ${reply.status}`);
  return cookie;
}

const post = (path: string, cookie: string, body: string, headers: Record<string, string> = {}): Promise<Reply> =>
  send("POST", path, {
    body,
    headers: { cookie, origin: `http://127.0.0.1:${port}`, "content-type": "application/json", ...headers },
  });

async function firstFindingId(cookie: string): Promise<string> {
  const state = decodeState((await send("GET", "/api/state", { headers: { cookie } })).body);
  const id = state.findings[0]?.id;
  if (!id) throw new Error("Expected a finding");
  return id;
}

beforeEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(join(cwd, "src"), { recursive: true });
  mkdirSync(join(cwd, ".agentlint"), { recursive: true });
  mkdirSync(assetsRoot, { recursive: true });
  writeFileSync(join(cwd, "src", "demo.ts"), 'export const result = danger("x");\n');
  writeFileSync(join(assetsRoot, "index.html"), "SHELL");
  writeFileSync(join(assetsRoot, "app..bundle.js"), "BUNDLE");
  writeFileSync(join(sandbox, "assets", "secret.txt"), "SECRET");
  runtime = ManagedRuntime.make(TestLayer);
  finished = [];
  lockfilesAtFinish = [];
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await listener.idle();
  await runtime.dispose();
  rmSync(sandbox, { recursive: true, force: true });
});

describe("review session bootstrap", () => {
  it("trades the link once for a per-port cookie that outlives it", async () => {
    await mount();
    const first = await send("GET", `/?token=${listener.bootstrapToken}`);
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe("/");
    const setCookie = first.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toMatch(new RegExp(`^agentlint_review_${port}=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/$`));
    expect(setCookie).not.toContain(listener.bootstrapToken);
    const cookie = setCookie.split(";")[0] ?? "";

    const replay = await send("GET", `/?token=${listener.bootstrapToken}`);
    expect(replay.status).toBe(403);
    expect(replay.headers["content-type"]).toContain("text/plain");
    expect(replay.body).toContain("agentlint review again");
    expect(replay.headers["set-cookie"]).toBeUndefined();

    // Reloading, or going back to the spent link, keeps the reviewer signed in.
    const revisit = await send("GET", `/?token=${listener.bootstrapToken}`, { headers: { cookie } });
    expect(revisit.status).toBe(302);
    expect(revisit.headers["set-cookie"]).toBeUndefined();
    expect((await send("GET", "/api/state", { headers: { cookie } })).status).toBe(200);
  });

  it("does not spend the link on a wrong token, and never accepts the link token as a cookie", async () => {
    await mount();
    expect((await send("GET", `/?token=${"0".repeat(64)}`)).status).toBe(403);
    const asCookie = `agentlint_review_${port}=${listener.bootstrapToken}`;
    expect((await send("GET", "/api/state", { headers: { cookie: asCookie } })).status).toBe(403);
    await expect(signIn()).resolves.toContain(`agentlint_review_${port}=`);
  });
});

describe("review request validation", () => {
  it("rejects every API route without the session", async () => {
    await mount();
    const origin = `http://127.0.0.1:${port}`;
    const json = { origin, "content-type": "application/json" };
    expect((await send("GET", "/api/state")).status).toBe(403);
    expect((await send("POST", "/api/action", { headers: json, body: "{}" })).status).toBe(403);
    expect((await send("POST", "/api/open", { headers: json, body: "{}" })).status).toBe(403);
    expect((await send("POST", "/api/finish", { headers: { origin } })).status).toBe(403);
    const otherPort = `agentlint_review_${port + 1}=${(await signIn()).split("=")[1]}`;
    expect((await send("GET", "/api/state", { headers: { cookie: otherPort } })).status).toBe(403);
    expect(finished).toEqual([]);
  });

  it("accepts the session cookie behind a planted cookie of the same name", async () => {
    await mount();
    const cookie = await signIn();
    const planted = `agentlint_review_${port}=planted; ${cookie}`;
    expect((await send("GET", "/api/state", { headers: { cookie: planted } })).status).toBe(200);
  });

  it("answers only to its loopback names", async () => {
    await mount();
    const cookie = await signIn();
    expect((await send("GET", "/", { headers: { host: `rebound.example:${port}` } })).status).toBe(403);
    expect((await send("GET", "/api/state", { headers: { cookie, host: "rebound.example" } })).status).toBe(403);
    expect((await send("GET", "/api/state", { headers: { cookie, host: `LOCALHOST:${port}` } })).status).toBe(200);
  });

  it("rejects cross-site state reads and cross-origin mutations", async () => {
    await mount();
    const cookie = await signIn();
    const read = (site: string) => send("GET", "/api/state", { headers: { cookie, "sec-fetch-site": site } });
    expect((await read("cross-site")).status).toBe(403);
    expect((await read("same-site")).status).toBe(403);
    expect((await read("same-origin")).status).toBe(200);
    expect((await read("none")).status).toBe(200);
    const mutation = await post("/api/finish", cookie, "", { origin: "https://attacker.example" });
    expect(mutation.status).toBe(403);
    expect((await post("/api/finish", cookie, "", { origin: `http://localhost:${port}` })).status).toBe(200);
  });

  it("answers 400 to a malformed request target and keeps serving", async () => {
    await mount();
    expect((await send("GET", "//")).status).toBe(400);
    expect((await send("GET", "//[")).status).toBe(400);
    expect((await send("GET", "/")).body).toBe("SHELL");
  });

  it("keeps static files inside the UI directory", async () => {
    await mount();
    const paths = [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/%2E%2E%2Fsecret.txt",
      "/..%5csecret.txt",
      "/..\\secret.txt",
      "/assets/../../secret.txt",
    ];
    const replies = await Promise.all(paths.map((path) => send("GET", path)));
    expect(replies.map((reply, index) => [paths[index], reply.status, reply.body])).toEqual(
      paths.map((path) => [path, 200, "SHELL"]),
    );
    expect((await send("GET", "/app..bundle.js")).body).toBe("BUNDLE");
  });

  it("answers 415, 413 and 400 to bodies it will not read, without describing the schema", async () => {
    await mount();
    const cookie = await signIn();
    expect((await post("/api/action", cookie, "{}", { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("/api/action", cookie, JSON.stringify({ pad: "x".repeat(200 * 1024) }))).status).toBe(413);
    const invalid = await Promise.all(
      ["/api/action", "/api/open"].flatMap((route) =>
        ["{", JSON.stringify({ type: "accept", findingId: 7 })].map((body) => post(route, cookie, body)),
      ),
    );
    expect(invalid.map((reply) => reply.status)).toEqual([400, 400, 400, 400]);
    expect(invalid.map((reply) => decodeResult(reply.body).message)).toEqual([
      "Invalid action request.",
      "Invalid action request.",
      "Invalid open request.",
      "Invalid open request.",
    ]);
  });

  it("keeps store failures out of the response", async () => {
    await mount();
    const cookie = await signIn();
    writeFileSync(join(cwd, ".agentlint", "acceptances.jsonl"), "not json\n");
    const terminal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reply = await send("GET", "/api/state", { headers: { cookie } });
    expect(reply.status).toBe(500);
    expect(decodeResult(reply.body)).toEqual({
      ok: false,
      message: "The review server failed. See the terminal running agentlint review.",
    });
    expect(terminal.mock.calls.flat().join("\n")).toMatch(/GET \/api\/state failed: .*acceptance record on line 1/u);
    terminal.mockRestore();
  });

  it("refuses repository actions in a detached session", async () => {
    await mount();
    const artifact = decodeState((await send("GET", "/api/state", { headers: { cookie: await signIn() } })).body);
    await new Promise((resolve) => server.close(resolve));
    await mount({ mode: "review", artifact });
    const cookie = await signIn();
    const findingId = artifact.findings[0]?.id;
    expect((await post("/api/action", cookie, JSON.stringify({ type: "withdraw", findingId }))).status).toBe(409);
    expect((await post("/api/open", cookie, JSON.stringify({ findingId, application: "vscode" }))).status).toBe(409);
  });
});

describe("review session finish", () => {
  it("lets an action in flight land before it reports and releases the session", async () => {
    await mount();
    const cookie = await signIn();
    const findingId = await firstFindingId(cookie);
    const action = post("/api/action", cookie, JSON.stringify({ type: "accept", findingId, reason: "Reviewed." }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const finish = await post("/api/finish", cookie, "");
    expect((await action).status).toBe(200);
    expect(finish.status).toBe(200);
    expect(finished).toEqual([expect.objectContaining({ summary: "1 accept" })]);
    expect(lockfilesAtFinish).toEqual([]);
    const late = await post("/api/action", cookie, JSON.stringify({ type: "withdraw", findingId }));
    expect([late.status, decodeResult(late.body).message]).toEqual([409, "The review is finishing."]);
  });
});
