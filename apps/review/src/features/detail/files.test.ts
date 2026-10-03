import { describe, expect, it } from "vitest";
import { directoryPaths, fileTree, toggleAllDirectories } from "./files";

describe("fileTree", () => {
  it("folds single-directory chains and lists directories before files", () => {
    expect(
      fileTree([
        "packages/contracts/ops-rpc/src/staff.ts",
        "apps/ops/src/server/staff-access.ts",
        "apps/ops/src/server/access-signing-keys.ts",
        "README.md",
      ]),
    ).toEqual([
      {
        kind: "directory",
        name: "apps/ops/src/server",
        path: "apps/ops/src/server",
        children: [
          { kind: "file", name: "access-signing-keys.ts", path: "apps/ops/src/server/access-signing-keys.ts" },
          { kind: "file", name: "staff-access.ts", path: "apps/ops/src/server/staff-access.ts" },
        ],
      },
      {
        kind: "directory",
        name: "packages/contracts/ops-rpc/src",
        path: "packages/contracts/ops-rpc/src",
        children: [{ kind: "file", name: "staff.ts", path: "packages/contracts/ops-rpc/src/staff.ts" }],
      },
      { kind: "file", name: "README.md", path: "README.md" },
    ]);
  });

  it("keeps a directory that holds files as its own row, keyed by its full path", () => {
    expect(fileTree(["src/a.ts", "src/lib/b.ts"])).toEqual([
      {
        kind: "directory",
        name: "src",
        path: "src",
        children: [
          {
            kind: "directory",
            name: "lib",
            path: "src/lib",
            children: [{ kind: "file", name: "b.ts", path: "src/lib/b.ts" }],
          },
          { kind: "file", name: "a.ts", path: "src/a.ts" },
        ],
      },
    ]);
  });

  it("lists every directory path, parents first", () => {
    expect(directoryPaths(fileTree(["src/a.ts", "src/lib/b.ts", "docs/guide/c.md"]))).toEqual([
      "docs/guide",
      "src",
      "src/lib",
    ]);
  });

  it("collapses every directory, then expands them all, leaving other trees alone", () => {
    const paths = ["src", "src/lib"];
    const collapsed = toggleAllDirectories({ collapsed: ["other", "src"], paths });
    expect(collapsed).toEqual(["other", "src", "src/lib"]);
    expect(toggleAllDirectories({ collapsed, paths })).toEqual(["other"]);
  });
});
