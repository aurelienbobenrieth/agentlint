import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { resolveFiles, type ResolveOptions } from "./file-resolver.js";

const cwd = join(tmpdir(), "agentlint-v02-file-resolver-test");
const TestEnv = Layer.succeed(
  Env,
  Env.of({ cwd, argv: [], actor: "agent:test", platform: "test", noColor: true, isTTY: false, setExitCode: () => {} }),
);
const TestLayer = TestEnv.pipe(Layer.provideMerge(NodeServices.layer));

/** The real file system, except that one entry cannot be inspected. */
const BrokenStatLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (real) =>
    FileSystem.makeNoop({
      ...real,
      stat: (path) =>
        path.replace(/\\/g, "/").endsWith("/src/broken.ts")
          ? Effect.fail(new PlatformError.BadArgument({ module: "FileSystem", method: "stat", description: "denied" }))
          : real.stat(path),
    }),
  ),
).pipe(Layer.provide(NodeServices.layer));
const BrokenLayer = Layer.mergeAll(TestEnv, BrokenStatLayer).pipe(Layer.provideMerge(NodeServices.layer));

const files: Record<string, string> = {
  "src/a.ts": "export const a = 1;\n",
  "src/b.js": "export const b = 2;\n",
  "src/broken.ts": "export const broken = true;\n",
  "src/nested/c.tsx": "export const c = 3;\n",
  "docs/guide.md": "# guide\n",
  README: "no extension\n",
  "node_modules/dep/index.ts": "export const dep = 1;\n",
};

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
  for (const [file, content] of Object.entries(files)) {
    const target = join(cwd, file);
    yield* fs.makeDirectory(join(target, ".."), { recursive: true });
    yield* fs.writeFileString(target, content);
  }
}).pipe(Effect.provide(NodeServices.layer));
const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
}).pipe(Effect.provide(NodeServices.layer));

const changedFiles = (paths: ReadonlyArray<string>) => ({ changedFiles: () => Effect.succeed(paths) });
const resolve = (options: ResolveOptions, git = changedFiles([]), layer = TestLayer) =>
  Effect.runPromise(resolveFiles(options, git).pipe(Effect.provide(layer)));

beforeAll(() => Effect.runPromise(setup));
afterAll(() => Effect.runPromise(cleanup));

describe("resolveFiles", () => {
  it("lists every file with an extension outside skipped directories for --all", async () => {
    expect(await resolve({ all: true })).toEqual([
      "docs/guide.md",
      "src/a.ts",
      "src/b.js",
      "src/broken.ts",
      "src/nested/c.tsx",
    ]);
  });

  it("uses Git-changed files when not scanning everything", async () => {
    const git = changedFiles(["src/b.js", "src\\a.ts", "src/a.ts"]);
    expect(await resolve({ all: false }, git)).toEqual(["src/a.ts", "src/b.js"]);
  });

  it("reports a Git failure with a reason", async () => {
    const failing = { changedFiles: () => Effect.fail(new Error("no merge base")) };
    await expect(resolve({ all: false }, failing)).rejects.toMatchObject({
      reason: "git",
      message: "Git error: Error: no merge base",
    });
  });

  it("treats glob positionals as patterns and other positionals as literal paths", async () => {
    expect(await resolve({ all: false, positionalFiles: ["src/**/*.ts"] })).toEqual(["src/a.ts", "src/broken.ts"]);
    expect(await resolve({ all: false, positionalFiles: ["src/b.js", join(cwd, "src", "a.ts")] })).toEqual([
      "src/a.ts",
      "src/b.js",
    ]);
    expect(await resolve({ all: false, positionalFiles: ["src/nested/*.tsx", "src/b.js"] })).toEqual([
      "src/b.js",
      "src/nested/c.tsx",
    ]);
  });

  it("applies config ignores to every candidate source", async () => {
    expect(await resolve({ all: true, configIgnores: ["docs/**", "**/nested/**"] })).toEqual([
      "src/a.ts",
      "src/b.js",
      "src/broken.ts",
    ]);
    expect(await resolve({ all: false, positionalFiles: ["src/a.ts"], configIgnores: ["src/**"] })).toEqual([]);
  });

  it("drops files without an extension", async () => {
    expect(await resolve({ all: false, positionalFiles: ["README", "src/a.ts"] })).toEqual(["src/a.ts"]);
    expect(await resolve({ all: false }, changedFiles(["README"]))).toEqual([]);
  });

  it("keeps the siblings of an entry that cannot be inspected", async () => {
    expect(await resolve({ all: true }, changedFiles([]), BrokenLayer)).toEqual([
      "docs/guide.md",
      "src/a.ts",
      "src/b.js",
      "src/nested/c.tsx",
    ]);
  });
});
