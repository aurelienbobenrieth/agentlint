import { Layer, ManagedRuntime, Schema } from "effect";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { featureTestLayer, featureTestRule } from "../../__fixtures__/feature-test-services.js";
import { encodeJson } from "../../shared/infrastructure/json.js";
import { ReviewActionResult, ReviewStatePayload, type ReviewFinishResult } from "./contract.js";
import { makeReviewListener, type ReviewListener, type ReviewListenerConfig } from "./server.js";

const sandbox = join(tmpdir(), "agentlint-v02-review-http-test");
const cwd = join(sandbox, "repository");
const assetsRoot = join(sandbox, "assets", "ui");
const rule = featureTestRule();
const TestLayer = featureTestLayer({ cwd, rules: [rule], actor: "human:test" });

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewStatePayload));
const decodeResult = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewActionResult));

interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

const fixture: {
  runtime?: ManagedRuntime.ManagedRuntime<Layer.Success<typeof TestLayer>, never>;
  server?: Server;
  listener?: ReviewListener;
  port: number;
  finished: ReviewFinishResult[];
  lockfilesAtFinish: string[];
} = { port: 0, finished: [], lockfilesAtFinish: [] };

const required = <A>(value: A | undefined): A => {
  if (value === undefined) throw new Error("HTTP test fixture is not mounted");
  return value;
};

const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  const state: { resolve: () => void } = { resolve: () => undefined };
  const promise = new Promise<void>((resolve) => (state.resolve = resolve));
  return { promise, resolve: () => state.resolve() };
};

async function mount(
  session: ReviewListenerConfig["session"] = { mode: "review" },
  options: Pick<ReviewListenerConfig, "executeAction"> = {},
): Promise<void> {
  fixture.listener = await required(fixture.runtime).runPromise(
    makeReviewListener({
      session,
      assetsRoot,
      applications: [],
      ...options,
      onFinish: (result) => {
        fixture.finished.push(result);
        fixture.lockfilesAtFinish = readdirSync(join(cwd, ".agentlint")).filter((name) => /\.(lock|tmp)$/u.test(name));
      },
    }),
  );
  fixture.server = createServer((request, response) => required(fixture.listener).handle({ request, response }));
  await new Promise<void>((resolve) => required(fixture.server).listen(0, "127.0.0.1", resolve));
  const address = required(fixture.server).address();
  if (address === null || Schema.is(Schema.String)(address)) throw new Error("Expected an IP server address");
  fixture.port = address.port;
}

/**
 * Raw client: unlike `fetch`, it sends the path and the headers exactly as written.
 */
function send({
  method,
  path,
  options = {},
}: {
  readonly method: string;
  readonly path: string;
  readonly options?: { readonly headers?: Record<string, string>; readonly body?: string };
}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: "127.0.0.1", port: fixture.port, method, path, headers: options.headers, agent: false },
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
  const reply = await send({ method: "GET", path: `/?token=${required(fixture.listener).bootstrapToken}` });
  const cookie = reply.headers["set-cookie"]?.[0]?.split(";")[0];
  if (reply.status !== 302 || !cookie) throw new Error(`Sign-in failed with ${reply.status}`);
  return cookie;
}

const post = ({
  path,
  cookie,
  body,
  headers = {},
}: {
  readonly path: string;
  readonly cookie: string;
  readonly body: string;
  readonly headers?: Record<string, string>;
}): Promise<Reply> =>
  send({
    method: "POST",
    path,
    options: {
      body,
      headers: {
        cookie,
        origin: `http://127.0.0.1:${fixture.port}`,
        "content-type": "application/json",
        ...headers,
      },
    },
  });

async function firstFindingId(cookie: string): Promise<string> {
  const state = decodeState((await send({ method: "GET", path: "/api/state", options: { headers: { cookie } } })).body);
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
  fixture.runtime = ManagedRuntime.make(TestLayer);
  fixture.finished = [];
  fixture.lockfilesAtFinish = [];
});

afterEach(async () => {
  required(fixture.server).closeAllConnections();
  await new Promise((resolve) => required(fixture.server).close(resolve));
  await required(fixture.listener).idle();
  await required(fixture.runtime).dispose();
  rmSync(sandbox, { recursive: true, force: true });
});

describe("review session bootstrap", () => {
  it("trades the link once for a per-port cookie that outlives it", async () => {
    await mount();
    const first = await send({ method: "GET", path: `/?token=${required(fixture.listener).bootstrapToken}` });
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe("/");
    const setCookie = first.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toMatch(
      new RegExp(`^agentlint_review_${fixture.port}=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/$`),
    );
    expect(setCookie).not.toContain(required(fixture.listener).bootstrapToken);
    const cookie = setCookie.split(";")[0] ?? "";

    const replay = await send({ method: "GET", path: `/?token=${required(fixture.listener).bootstrapToken}` });
    expect(replay.status).toBe(403);
    expect(replay.headers["content-type"]).toContain("text/plain");
    expect(replay.body).toContain("agentlint review again");
    expect(replay.headers["set-cookie"]).toBeUndefined();

    // Reloading, or going back to the spent link, keeps the reviewer signed in.
    const revisit = await send({
      method: "GET",
      path: `/?token=${required(fixture.listener).bootstrapToken}`,
      options: { headers: { cookie } },
    });
    expect(revisit.status).toBe(302);
    expect(revisit.headers["set-cookie"]).toBeUndefined();
    expect((await send({ method: "GET", path: "/api/state", options: { headers: { cookie } } })).status).toBe(200);
  });

  it("does not spend the link on a wrong token, and never accepts the link token as a cookie", async () => {
    await mount();
    expect((await send({ method: "GET", path: `/?token=${"0".repeat(64)}` })).status).toBe(403);
    const asCookie = `agentlint_review_${fixture.port}=${required(fixture.listener).bootstrapToken}`;
    expect((await send({ method: "GET", path: "/api/state", options: { headers: { cookie: asCookie } } })).status).toBe(
      403,
    );
    await expect(signIn()).resolves.toContain(`agentlint_review_${fixture.port}=`);
  });
});

describe("review request validation", () => {
  it("rejects every API route without the session", async () => {
    await mount();
    const origin = `http://127.0.0.1:${fixture.port}`;
    const json = { origin, "content-type": "application/json" };
    expect((await send({ method: "GET", path: "/api/state" })).status).toBe(403);
    expect((await send({ method: "POST", path: "/api/action", options: { headers: json, body: "{}" } })).status).toBe(
      403,
    );
    expect((await send({ method: "POST", path: "/api/open", options: { headers: json, body: "{}" } })).status).toBe(
      403,
    );
    expect((await send({ method: "POST", path: "/api/finish", options: { headers: { origin } } })).status).toBe(403);
    const otherPort = `agentlint_review_${fixture.port + 1}=${(await signIn()).split("=")[1]}`;
    expect(
      (await send({ method: "GET", path: "/api/state", options: { headers: { cookie: otherPort } } })).status,
    ).toBe(403);
    expect(fixture.finished).toEqual([]);
  });

  it("accepts the session cookie behind a planted cookie of the same name", async () => {
    await mount();
    const cookie = await signIn();
    const planted = `agentlint_review_${fixture.port}=planted; ${cookie}`;
    expect((await send({ method: "GET", path: "/api/state", options: { headers: { cookie: planted } } })).status).toBe(
      200,
    );
  });

  it("answers only to its loopback names", async () => {
    await mount();
    const cookie = await signIn();
    expect(
      (await send({ method: "GET", path: "/", options: { headers: { host: `rebound.example:${fixture.port}` } } }))
        .status,
    ).toBe(403);
    expect(
      (await send({ method: "GET", path: "/api/state", options: { headers: { cookie, host: "rebound.example" } } }))
        .status,
    ).toBe(403);
    expect(
      (
        await send({
          method: "GET",
          path: "/api/state",
          options: { headers: { cookie, host: `LOCALHOST:${fixture.port}` } },
        })
      ).status,
    ).toBe(200);
  });

  it("rejects cross-site state reads and cross-origin mutations", async () => {
    await mount();
    const cookie = await signIn();
    const read = (site: string) =>
      send({ method: "GET", path: "/api/state", options: { headers: { cookie, "sec-fetch-site": site } } });
    expect((await read("cross-site")).status).toBe(403);
    expect((await read("same-site")).status).toBe(403);
    expect((await read("same-origin")).status).toBe(200);
    expect((await read("none")).status).toBe(200);
    const mutation = await post({
      path: "/api/finish",
      cookie,
      body: "",
      headers: { origin: "https://attacker.example" },
    });
    expect(mutation.status).toBe(403);
    expect(
      (await post({ path: "/api/finish", cookie, body: "", headers: { origin: `http://localhost:${fixture.port}` } }))
        .status,
    ).toBe(200);
  });

  it("answers 400 to a malformed request target and keeps serving", async () => {
    await mount();
    expect((await send({ method: "GET", path: "//" })).status).toBe(400);
    expect((await send({ method: "GET", path: "//[" })).status).toBe(400);
    expect((await send({ method: "GET", path: "/" })).body).toBe("SHELL");
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
    const replies = await Promise.all(paths.map((path) => send({ method: "GET", path })));
    expect(replies.map((reply, index) => [paths[index], reply.status, reply.body])).toEqual(
      paths.map((path) => [path, 200, "SHELL"]),
    );
    expect((await send({ method: "GET", path: "/app..bundle.js" })).body).toBe("BUNDLE");
  });

  it("answers 415, 413 and 400 to bodies it will not read, without describing the schema", async () => {
    await mount();
    const cookie = await signIn();
    expect(
      (await post({ path: "/api/action", cookie, body: "{}", headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    expect(
      (await post({ path: "/api/action", cookie, body: encodeJson({ pad: "x".repeat(200 * 1024) }) })).status,
    ).toBe(413);
    const invalid = await Promise.all(
      ["/api/action", "/api/open"].flatMap((route) =>
        ["{", encodeJson({ type: "accept", findingId: 7 })].map((body) => post({ path: route, cookie, body })),
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
    const reply = await send({ method: "GET", path: "/api/state", options: { headers: { cookie } } });
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
    const artifact = decodeState(
      (await send({ method: "GET", path: "/api/state", options: { headers: { cookie: await signIn() } } })).body,
    );
    await new Promise((resolve) => required(fixture.server).close(resolve));
    await mount({ mode: "review", artifact });
    const cookie = await signIn();
    const findingId = artifact.findings[0]?.id;
    expect(
      (await post({ path: "/api/action", cookie, body: encodeJson({ type: "withdraw", findingId }) })).status,
    ).toBe(409);
    expect(
      (await post({ path: "/api/open", cookie, body: encodeJson({ findingId, application: "vscode" }) })).status,
    ).toBe(409);
  });
});

describe("review session finish", () => {
  it("lets an action in flight land before it reports and releases the session", async () => {
    const started = deferred();
    const release = deferred();
    await mount(
      { mode: "review" },
      {
        executeAction: async (proceed) => {
          started.resolve();
          await release.promise;
          return proceed();
        },
      },
    );
    const cookie = await signIn();
    const findingId = await firstFindingId(cookie);
    const action = post({
      path: "/api/action",
      cookie,
      body: encodeJson({ type: "accept", findingId, reason: "Reviewed." }),
    });
    await started.promise;
    const finish = post({ path: "/api/finish", cookie, body: "" });
    release.resolve();
    expect((await action).status).toBe(200);
    expect((await finish).status).toBe(200);
    expect(fixture.finished).toEqual([expect.objectContaining({ summary: "1 accept" })]);
    expect(fixture.lockfilesAtFinish).toEqual([]);
    const late = await post({ path: "/api/action", cookie, body: encodeJson({ type: "withdraw", findingId }) });
    expect([late.status, decodeResult(late.body).message]).toEqual([409, "The review is finishing."]);
  });
});
