import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path, PlatformError, Schema } from "effect";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { Env } from "../../config/env.js";
import { Git } from "../infrastructure/git.js";
import { isInside, resolveFiles, toRepositoryPath, type ResolveOptions, type ResolverGit } from "./file-resolver.js";

const cwd = join(tmpdir(), "agentlint-v02-file-resolver-test");
const testEnv = (directory: string) =>
  Layer.succeed(
    Env,
    Env.of({
      cwd: directory,
      argv: [],
      actor: "agent:test",
      platform: "test",
      noColor: true,
      isTTY: false,
      setExitCode: () => {},
    }),
  );
const envLayer = (directory: string) => testEnv(directory).pipe(Layer.provideMerge(NodeServices.layer));
const TestEnv = testEnv(cwd);
const TestLayer = envLayer(cwd);

/**
 * The real file system, except that one entry cannot be inspected.
 */
const BrokenStatLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (real) =>
    FileSystem.makeNoop({
      ...real,
      stat: (path) =>
        path.replace(/\\/g, "/").endsWith("/src/broken.ts")
          ? Effect.fail(PlatformError.badArgument({ module: "FileSystem", method: "stat", description: "denied" }))
          : real.stat(path),
    }),
  ),
).pipe(Layer.provide(NodeServices.layer));
const BrokenLayer = Layer.mergeAll(TestEnv, BrokenStatLayer).pipe(Layer.provideMerge(NodeServices.layer));

const files = {
  "src/a.ts": "export const a = 1;\n",
  "src/b.js": "export const b = 2;\n",
  "src/broken.ts": "export const broken = true;\n",
  "src/nested/c.tsx": "export const c = 3;\n",
  "docs/guide.md": "# guide\n",
  README: "no extension\n",
  "node_modules/dep/index.ts": "export const dep = 1;\n",
};

class TestGitError extends Schema.TaggedError<TestGitError>()("TestGitError", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

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
const resolve = ({
  options,
  git = changedFiles([]),
  layer = TestLayer,
}: {
  readonly options: ResolveOptions;
  readonly git?: ResolverGit<Error>;
  readonly layer?: Layer.Layer<Env | NodeServices.NodeServices>;
}) => Effect.runPromise(resolveFiles({ options, gitService: git }).pipe(Effect.provide(layer)));

beforeAll(() => Effect.runPromise(setup));
afterAll(() => Effect.runPromise(cleanup));

describe("resolveFiles", () => {
  it("accepts absolute files through an alias of the repository directory", async () => {
    const alias = `${cwd}-alias`;
    symlinkSync(cwd, alias, "junction");
    try {
      const aliasEnv = Layer.succeed(
        Env,
        Env.of({
          cwd: alias,
          argv: [],
          actor: "agent:test",
          platform: "test",
          noColor: true,
          isTTY: false,
          setExitCode: () => {},
        }),
      );
      const layer = aliasEnv.pipe(Layer.provideMerge(NodeServices.layer));
      expect(
        await resolve({
          options: { all: true, positionalFiles: [join(alias, "src/a.ts"), join(cwd, "src/b.js")] },
          git: changedFiles([]),
          layer,
        }),
      ).toEqual(["src/a.ts", "src/b.js"]);
    } finally {
      unlinkSync(alias);
    }
  });

  it("rejects explicit paths outside the repository", async () => {
    await expect(resolve({ options: { all: true, positionalFiles: [".."] } })).rejects.toMatchObject({
      reason: "filesystem",
    });
  });

  it("lists every file with an extension outside skipped directories for --all", async () => {
    expect(await resolve({ options: { all: true } })).toEqual([
      "docs/guide.md",
      "src/a.ts",
      "src/b.js",
      "src/broken.ts",
      "src/nested/c.tsx",
    ]);
  });

  it("uses Git-changed files when not scanning everything", async () => {
    // The native separator is rewritten; a backslash is a separator only on Windows.
    const git = changedFiles(["src/b.js", join("src", "a.ts"), "src/a.ts"]);
    expect(await resolve({ options: { all: false }, git })).toEqual(["src/a.ts", "src/b.js"]);
  });

  it("passes a Git failure through without wrapping it", async () => {
    const failing = { changedFiles: () => Effect.fail(new TestGitError({ detail: "no merge base" })) };
    await expect(resolve({ options: { all: false }, git: failing })).rejects.toThrow(/^no merge base$/);
  });

  it("keeps a backslash in a file name where it is not a separator", () => {
    expect(toRepositoryPath({ value: "src\\a.ts", separator: "\\" })).toBe("src/a.ts");
    expect(toRepositoryPath({ value: "src/odd\\name.ts", separator: "/" })).toBe("src/odd\\name.ts");
  });

  it("treats glob positionals as patterns and other positionals as literal paths", async () => {
    expect(await resolve({ options: { all: false, positionalFiles: ["src/**/*.ts"] } })).toEqual([
      "src/a.ts",
      "src/broken.ts",
    ]);
    expect(await resolve({ options: { all: false, positionalFiles: ["src/b.js", join(cwd, "src", "a.ts")] } })).toEqual(
      ["src/a.ts", "src/b.js"],
    );
    expect(await resolve({ options: { all: false, positionalFiles: ["src/nested/*.tsx", "src/b.js"] } })).toEqual([
      "src/b.js",
      "src/nested/c.tsx",
    ]);
  });

  it("applies config ignores to every candidate source", async () => {
    expect(await resolve({ options: { all: true, configIgnores: ["docs/**", "**/nested/**"] } })).toEqual([
      "src/a.ts",
      "src/b.js",
      "src/broken.ts",
    ]);
    expect(
      await resolve({ options: { all: false, positionalFiles: ["src/a.ts"], configIgnores: ["src/**"] } }),
    ).toEqual([]);
  });

  it("drops files without an extension", async () => {
    expect(await resolve({ options: { all: false, positionalFiles: ["README", "src/a.ts"] } })).toEqual(["src/a.ts"]);
    expect(await resolve({ options: { all: false }, git: changedFiles(["README"]) })).toEqual([]);
  });

  it("fails a complete scan when an entry cannot be inspected", async () => {
    await expect(resolve({ options: { all: true }, git: changedFiles([]), layer: BrokenLayer })).rejects.toMatchObject({
      reason: "filesystem",
    });
  });
  it("rejects missing explicit paths and expands explicit directories", async () => {
    await expect(resolve({ options: { all: false, positionalFiles: ["missing.ts"] } })).rejects.toMatchObject({
      reason: "filesystem",
    });
    expect(await resolve({ options: { all: false, positionalFiles: ["src/nested"] } })).toEqual(["src/nested/c.tsx"]);
  });
});

describe("resolveFiles over a repository", () => {
  const withDirectory = async ({
    contents,
    body,
  }: {
    readonly contents: Record<string, string>;
    readonly body: (context: {
      readonly root: string;
      readonly git: (...args: string[]) => string;
      readonly resolveWithGit: (options: ResolveOptions) => Promise<ReadonlyArray<string>>;
    }) => Promise<void>;
  }) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "agentlint-resolver-")));
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
        { cwd: root, windowsHide: true, stdio: "pipe", encoding: "utf8" },
      ).trim();
    const layer = Git.layer.pipe(Layer.provideMerge(envLayer(root)));
    try {
      for (const [file, content] of Object.entries(contents)) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
      }
      await body({
        root,
        git,
        resolveWithGit: (options) =>
          Effect.runPromise(
            Effect.flatMap(Git, (service) => resolveFiles({ options, gitService: service })).pipe(
              Effect.provide(layer),
            ),
          ),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  const tree = {
    ".gitignore": "build/\nnode_modules/\n",
    "src/dist/x.ts": "x();\n",
    "src/coverage/y.ts": "y();\n",
    "src/.hidden/z.ts": "z();\n",
    "src/gone.ts": "gone();\n",
    "build/x.ts": "ignored();\n",
    "node_modules/dep/index.ts": "dep();\n",
    ".agentlint/.cache/last-check.json": "{}\n",
  };

  it("scans what Git tracks or would add, at any depth, and nothing Git ignores", async () => {
    await withDirectory({
      contents: tree,
      body: async ({ root, git, resolveWithGit }) => {
        git("init", "-b", "main");
        git("add", ".");
        // The cache is excluded even when the repository forgot to ignore it.
        git("add", "--force", ".agentlint/.cache/last-check.json");
        writeFileSync(join(root, "src/untracked.ts"), "u();\n");
        // Deleted from disk, still in the index.
        rmSync(join(root, "src/gone.ts"));
        expect(await resolveWithGit({ all: true })).toEqual([
          "src/.hidden/z.ts",
          "src/coverage/y.ts",
          "src/dist/x.ts",
          "src/untracked.ts",
        ]);
        expect(await resolveWithGit({ all: true, configIgnores: ["src/coverage/**"] })).not.toContain(
          "src/coverage/y.ts",
        );
        expect(await resolveWithGit({ all: false, positionalFiles: ["**/x.ts"] })).toEqual(["src/dist/x.ts"]);
      },
    });
  });

  it("still scans a directory that is not a Git repository, skipping only node_modules and .git", async () => {
    await withDirectory({
      contents: tree,
      body: async ({ resolveWithGit }) => {
        expect(await resolveWithGit({ all: true })).toEqual([
          "build/x.ts",
          "src/.hidden/z.ts",
          "src/coverage/y.ts",
          "src/dist/x.ts",
          "src/gone.ts",
        ]);
      },
    });
  });

  it("matches dotfiles with explicit globs", async () => {
    await withDirectory({
      contents: { "src/.hidden/x.ts": "x();\n", "src/.x.ts": "x();\n" },
      body: async ({ resolveWithGit }) => {
        expect(await resolveWithGit({ all: false, positionalFiles: ["src/**"] })).toEqual([
          "src/.hidden/x.ts",
          "src/.x.ts",
        ]);
      },
    });
  });

  it("never returns a path that resolves outside the repository or into .git", async () => {
    await withDirectory({
      contents: { "src/a.ts": "a();\n" },
      body: async ({ root, git, resolveWithGit }) => {
        const outside = realpathSync(mkdtempSync(join(tmpdir(), "agentlint-resolver-outside-")));
        try {
          git("init", "-b", "main");
          writeFileSync(join(outside, "secret.ts"), "SECRET();\n");
          // A junction needs no privilege on Windows; elsewhere Node creates a directory symlink.
          symlinkSync(outside, join(root, "src", "linked"), "junction");
          symlinkSync(join(root, ".git"), join(root, "src", "meta"), "junction");
          writeFileSync(join(root, ".git", "leak.ts"), "LEAK();\n");
          const changed = {
            changedFiles: () => Effect.succeed(["src/a.ts", "src/linked/secret.ts", "src/meta/leak.ts"]),
          };
          expect(await resolve({ options: { all: false }, git: changed, layer: envLayer(root) })).toEqual(["src/a.ts"]);
          expect(await resolveWithGit({ all: true })).toEqual(["src/a.ts"]);
        } finally {
          rmSync(join(root, "src", "linked"), { force: true });
          rmSync(join(root, "src", "meta"), { force: true });
          rmSync(outside, { recursive: true, force: true });
        }
      },
    });
  });

  it.effect("decides containment once for every caller", () =>
    Effect.gen(function* () {
      const path = yield* Effect.provide(Path.Path, NodeServices.layer);
      const root = join(tmpdir(), "repo");
      expect(isInside({ path, root, candidate: root })).toBe(true);
      expect(isInside({ path, root, candidate: join(root, "src", "a.ts") })).toBe(true);
      expect(isInside({ path, root, candidate: join(root, "..", "repo-sibling", "a.ts") })).toBe(false);
      expect(isInside({ path, root, candidate: join(root, "..") })).toBe(false);
    }),
  );
});
