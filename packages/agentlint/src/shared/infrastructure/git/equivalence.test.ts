import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { perFileChangeSet } from "../../../__fixtures__/per-file-change-set.js";
import { Env } from "../../../config/env.js";
import { Git } from "./service.js";

const HUGE_BYTES = 64 * 1024 * 1024 + 16;
const lines = (count: number, label: string) =>
  Array.from({ length: count }, (_, index) => `${label} ${index}`).join("\n") + "\n";

/**
 * One repository holding every shape `changeSet` distinguishes, committed on a `base` tag and then changed through a
 * second commit, the index, the working tree, a merge conflict, and untracked files.
 */
const repository = { cwd: "" };

const git = (...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { cwd: repository.cwd, windowsHide: true, stdio: "pipe", encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  ).trim();
const write = (file: string, content: string | Uint8Array) => {
  mkdirSync(dirname(join(repository.cwd, file)), { recursive: true });
  writeFileSync(join(repository.cwd, file), content);
};
const remove = (file: string) => rmSync(join(repository.cwd, file), { recursive: true, force: true });
const trySymlink = (target: string, file: string): boolean => {
  try {
    symlinkSync(target, join(repository.cwd, file), "file");
    return true;
  } catch {
    // Windows without the symbolic link privilege: the index-only symlink below still covers the baseline side.
    return false;
  }
};

const symlinksSupported = () => {
  try {
    return git("config", "--get", "core.symlinks") !== "false";
  } catch {
    // Unset means the default, true.
    return true;
  }
};

const MANY = Array.from(
  { length: 320 },
  (_, index) => `many/a-deliberately-long-directory-name/and-a-long-file-name-number-${index}.ts`,
);
const unixOnlyNames = process.platform === "win32" ? [] : ['quote"d.ts', "back\\slash.ts", "tab\tname.ts"];

beforeAll(() => {
  repository.cwd = realpathSync(mkdtempSync(join(tmpdir(), "agentlint-git-equivalence-")));
  git("init", "-b", "main");
  const multi = lines(60, "line");
  write("modified.ts", multi);
  write("deleted.ts", lines(5, "gone"));
  write("deleted.bin", new Uint8Array([0, 1, 2, 3, 0, 5]));
  write("renamed-old.ts", lines(40, "moved"));
  write("renamed-pure-old.ts", lines(20, "pure"));
  write("copy-source.ts", lines(30, "copied"));
  write("binary.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]));
  write("text-to-binary.txt", "plain text\n");
  write("binary-to-text.dat", new Uint8Array([0, 0, 7]));
  write("crlf-work.txt", "one\ntwo\nthree\n");
  write("crlf-base.txt", "one\r\ntwo\r\nthree\r\n");
  write("empty-base.txt", "");
  write("becomes-empty.txt", "not empty\n");
  write("no-newline.txt", "last line without newline");
  write("dir with space/ünïcödé file.ts", lines(8, "unicode"));
  write("spaced name.ts", lines(8, "spaced"));
  write("mode.sh", "#!/bin/sh\necho mode\n");
  write("latin1.txt", Buffer.from("caf\xe9 cr\xe8me\n", "latin1"));
  write("swap", "a file that becomes a directory\n");
  write("huge.txt", "x".repeat(HUGE_BYTES - 1) + "\n");
  write("sub/inner.ts", lines(10, "inner"));
  write("sub/deleted-inner.ts", lines(3, "inner gone"));
  write("pages/[id].tsx", "route\n");
  write("conflict.ts", "shared\n");
  write(".gitignore", "ignored/\n");
  for (const file of MANY) write(file, `export const value = "${file}";\n`);
  for (const file of unixOnlyNames) write(file, lines(3, "odd"));
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  // A symbolic link and a submodule exist in the baseline index without needing either on disk.
  const seed = git("rev-parse", "HEAD");
  git("update-index", "--add", "--cacheinfo", `160000,${seed},vendor/sub`);
  const symlinkTarget = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repository.cwd,
    input: "modified.ts",
    encoding: "utf8",
  }).trim();
  git("update-index", "--add", "--cacheinfo", `120000,${symlinkTarget},link.ts`);
  git("commit", "-q", "-m", "baseline links");
  git("tag", "base");

  // Committed after the baseline.
  write("modified.ts", multi.replace("line 3\n", "line three\n").replace("line 40\n", "line forty\n"));
  write("committed-added.ts", lines(4, "committed"));
  git("add", "modified.ts", "committed-added.ts");
  git("commit", "-q", "-m", "second");

  // A conflicting merge leaves an unmerged path.
  git("checkout", "-q", "-b", "other");
  write("conflict.ts", "theirs\n");
  git("add", "conflict.ts");
  git("commit", "-q", "-m", "theirs");
  git("checkout", "-q", "main");
  write("conflict.ts", "ours\n");
  git("add", "conflict.ts");
  git("commit", "-q", "-m", "ours");
  try {
    git("merge", "-q", "other");
  } catch {
    // The conflict is the point.
  }

  // Staged changes.
  write("staged-added.ts", lines(3, "staged"));
  write("intent.ts", lines(2, "intent"));
  git("add", "staged-added.ts");
  git("add", "-N", "intent.ts");
  git("mv", "renamed-pure-old.ts", "renamed-pure-new.ts");
  git("update-index", "--chmod=+x", "mode.sh");
  git("update-index", "--cacheinfo", `160000,${git("rev-parse", "HEAD")},vendor/sub`);
  remove("swap");
  git("rm", "-q", "--cached", "swap");
  write("swap/inner.ts", "now a directory\n");
  git("add", "swap/inner.ts");

  // Working tree changes.
  remove("deleted.ts");
  remove("deleted.bin");
  remove("renamed-old.ts");
  write("renamed-new.ts", lines(40, "moved").replace("moved 7\n", "moved seven\n"));
  git("add", "-A", "renamed-old.ts", "renamed-new.ts");
  // An unstaged edit on top of the staged rename.
  write(
    "renamed-new.ts",
    lines(40, "moved").replace("moved 7\n", "moved seven\n").replace("moved 30\n", "moved 30!\n"),
  );
  write("copy-target.ts", lines(30, "copied"));
  write("binary.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 9, 9]));
  write("text-to-binary.txt", new Uint8Array([0x74, 0, 0x78]));
  write("binary-to-text.dat", "now text\n");
  write("crlf-work.txt", "one\r\ntwo changed\r\nthree\r\n");
  write("crlf-base.txt", "one\r\ntwo\r\nthree\r\nfour\r\n");
  write("empty-base.txt", "filled\n");
  write("becomes-empty.txt", "");
  write("no-newline.txt", "last line changed without newline");
  write("dir with space/ünïcödé file.ts", lines(8, "unicode").replace("unicode 2", "ünïcödé 2"));
  write("spaced name.ts", lines(8, "spaced").replace("spaced 5", "spaced five"));
  write("latin1.txt", Buffer.from("caf\xe9 cr\xe8me br\xfbl\xe9e\n", "latin1"));
  write("huge.txt", "x".repeat(HUGE_BYTES - 1) + "\ny\n");
  write("sub/inner.ts", lines(10, "inner").replace("inner 4", "inner four"));
  remove("sub/deleted-inner.ts");
  write("sub/untracked-inner.ts", "untracked inside sub\n");
  write("pages/[id].tsx", "route\nchanged\n");
  write("link.ts", "a regular file where a symbolic link was\n");
  mkdirSync(join(repository.cwd, "vendor", "sub"), { recursive: true });
  for (const [index, file] of MANY.entries())
    write(file, `export const value = "${file}";\nexport const index = ${index};\n`);
  for (const file of unixOnlyNames) write(file, lines(3, "odd").replace("odd 1", "odd one"));
  trySymlink("modified.ts", "new-link.ts");

  // Untracked files, one of them binary, and an ignored one that must never appear.
  write("untracked.ts", lines(3, "untracked"));
  write("untracked empty.txt", "");
  write("untracked.bin", new Uint8Array([1, 0, 2]));
  write("ignored/skip.ts", "ignored\n");
}, 120_000);

afterAll(() => {
  if (repository.cwd) rmSync(repository.cwd, { recursive: true, force: true });
});

const environment = (cwd: string) =>
  Layer.succeed(
    Env,
    Env.of({
      cwd,
      argv: [],
      actor: "agent:test",
      platform: "test",
      noColor: true,
      isTTY: false,
      setExitCode: () => {},
    }),
  );

/**
 * Leaves out the long-path files, the huge file, and one side of each rename.
 */
const someOfTheChanges = (path: string) =>
  !path.startsWith("many/") && path !== "renamed-new.ts" && path !== "renamed-pure-old.ts" && path !== "huge.txt";

const compare = async ({ cwd, include }: { readonly cwd: string; readonly include?: (path: string) => boolean }) => {
  const batched = await Effect.runPromise(
    Effect.flatMap(Git, (service) => service.changeSet({ baseRef: "base", ...(include ? { include } : {}) })).pipe(
      Effect.provide(Git.layer),
      Effect.provide(NodeServices.layer),
      Effect.provide(environment(cwd)),
    ),
  );
  const reference = await Effect.runPromise(
    perFileChangeSet({ cwd, baseRef: "base", ...(include ? { include } : {}) }).pipe(
      Effect.provide(NodeServices.layer),
    ),
  );
  return { batched, reference };
};

describe("batched changeSet", () => {
  it("reproduces the per-file change set for every kind of change", async () => {
    const { batched, reference } = await compare({ cwd: repository.cwd });
    expect(batched).toEqual(reference);

    // The fixture has to reach every branch, or equality proves nothing.
    const byPath = new Map(batched.files.map((file) => [file.path, file]));
    expect(new Set(batched.files.map((file) => file.status))).toEqual(
      new Set(["added", "modified", "deleted", "renamed"]),
    );
    expect(byPath.get("renamed-new.ts")?.previousPath).toBe("renamed-old.ts");
    expect(byPath.get("renamed-pure-new.ts")?.previousPath).toBe("renamed-pure-old.ts");
    expect(byPath.get("huge.txt")?.before?.digest).toMatch(/^git-blob:/);
    expect(byPath.get("huge.txt")?.after?.digest).toMatch(/^git-blob:/);
    expect(byPath.get("binary.png")?.after?.content).toBeUndefined();
    expect(byPath.get("dir with space/ünïcödé file.ts")?.hunks.length).toBe(1);
    expect(byPath.get("latin1.txt")?.hunks.length).toBe(1);
    // A symbolic link replaced by a file is two patches for one path, where the checkout supports links.
    expect(byPath.get("link.ts")?.hunks.length).toBe(symlinksSupported() ? 2 : 1);
    // A file replaced by a directory: the path's diff also covers what now lives below it.
    expect(byPath.get("swap")?.hunks.length).toBe(2);
    expect(byPath.get("conflict.ts")).toBeDefined();
    expect(byPath.has("vendor/sub")).toBe(false);
    expect(byPath.has("ignored/skip.ts")).toBe(false);
    expect(batched.files.filter((file) => file.path.startsWith("many/")).length).toBe(MANY.length);
    for (const name of unixOnlyNames) expect(byPath.get(name)?.hunks.length).toBe(1);
  }, 120_000);

  it("reproduces a filtered change set, including a rename selected by one side", async () => {
    const { batched, reference } = await compare({ cwd: repository.cwd, include: someOfTheChanges });
    expect(batched).toEqual(reference);
    expect(batched.files.map((file) => file.path)).toContain("renamed-new.ts");
    expect(batched.files.map((file) => file.path)).not.toContain(
      "many/a-deliberately-long-directory-name/and-a-long-file-name-number-0.ts",
    );
  }, 120_000);

  it("reproduces the change set seen from a subdirectory", async () => {
    const { batched, reference } = await compare({ cwd: join(repository.cwd, "sub") });
    expect(batched).toEqual(reference);
    expect(batched.files.map((file) => file.path)).toEqual(["deleted-inner.ts", "inner.ts", "untracked-inner.ts"]);
  }, 120_000);
});
