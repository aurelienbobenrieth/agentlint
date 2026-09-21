import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Array as EffectArray, Order } from "effect";
import { describe, expect, it, vi } from "vitest";
import { detectEditorApplications, editorInvocation, launcherFromLookup, openInEditor } from "./editor.js";

describe("review editor adapters", () => {
  it("keeps a Windows file target in one allowlisted argument", () => {
    expect(
      editorInvocation({
        application: "vscode",
        platform: "win32",
        file: String.raw`C:\work tree\démo.ts`,
        line: 7,
        column: 3,
      }),
    ).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "vscode://file/C:/work%20tree/d%C3%A9mo.ts:7:3"],
    });
    expect(
      editorInvocation({
        application: "explorer",
        platform: "win32",
        file: String.raw`C:\work tree\démo.ts`,
        line: 7,
        column: 3,
      }),
    ).toEqual({
      command: "explorer.exe",
      args: [String.raw`/select,C:\work tree\démo.ts`],
    });
  });

  it("uses platform launchers without a shell", () => {
    expect(
      editorInvocation({ application: "zed", platform: "darwin", file: "/work tree/demo.ts", line: 2, column: 9 }),
    ).toEqual({
      command: "open",
      args: ["zed://file/work%20tree/demo.ts:2:9"],
    });
    expect(
      editorInvocation({ application: "explorer", platform: "linux", file: "/work tree/demo.ts", line: 2, column: 9 }),
    ).toEqual({
      command: "xdg-open",
      args: ["/work tree"],
    });
  });

  it("prefers a command-line launcher and resolves Windows shims to the executable", () => {
    expect(
      editorInvocation({
        application: "cursor",
        platform: "win32",
        file: String.raw`C:\repo\a.ts`,
        line: 4,
        column: 5,
        launcher: String.raw`C:\Apps\cursor\Cursor.exe`,
      }),
    ).toEqual({
      command: String.raw`C:\Apps\cursor\Cursor.exe`,
      args: ["--goto", String.raw`C:\repo\a.ts:4:5`],
    });
    expect(
      editorInvocation({
        application: "zed",
        platform: "linux",
        file: "/repo/a.ts",
        line: 4,
        column: 5,
        launcher: "/usr/bin/zed",
      }),
    ).toEqual({
      command: "/usr/bin/zed",
      args: ["/repo/a.ts:4:5"],
    });
    const cursor = { windowsExecutable: (shim: string) => `${shim}${String.raw`\..\Cursor.exe`}` };
    expect(
      launcherFromLookup({
        application: cursor,
        platform: "win32",
        output: `${String.raw`C:\Apps\cursor\bin\cursor`}\r\n${String.raw`C:\Apps\cursor\bin\cursor.cmd`}\r\n`,
      }),
    ).toBe(String.raw`C:\Apps\cursor\bin\..\Cursor.exe`);
    expect(
      launcherFromLookup({
        application: cursor,
        platform: "win32",
        output: `${String.raw`C:\Apps\Zed\bin\zed`}\r\n${String.raw`C:\Apps\Zed\bin\Zed.exe`}\r\n`,
      }),
    ).toBe(String.raw`C:\Apps\Zed\bin\Zed.exe`);
    expect(launcherFromLookup({ application: cursor, platform: "darwin", output: "/usr/local/bin/cursor\n" })).toBe(
      "/usr/local/bin/cursor",
    );
  });

  it("reports only applications whose handlers are detected", async () => {
    const runner = vi.fn<
      (invocation: { readonly command: string; readonly args: ReadonlyArray<string> }) => Promise<string>
    >(async ({ args }) => {
      if (args.some((arg) => arg.includes("vscode") || arg.endsWith("explorer.exe"))) return "available";
      throw new Error("missing");
    });
    await expect(detectEditorApplications({ platform: "win32", runner })).resolves.toEqual([
      { id: "vscode", label: "VS Code" },
      { id: "vscode-insiders", label: "VS Code Insiders" },
      { id: "explorer", label: "File Explorer" },
    ]);
  });

  it("looks launchers up on PATH only and never takes one from the reviewed repository", async () => {
    const repository = mkdtempSync(join(tmpdir(), "agentlint-editor-repository-"));
    const installed = mkdtempSync(join(tmpdir(), "agentlint-editor-installed-"));
    try {
      writeFileSync(join(repository, "code.exe"), "");
      writeFileSync(join(installed, "cursor.exe"), "");
      const lookups: string[] = [];
      const detect = async ({ command, args }: { readonly command: string; readonly args: ReadonlyArray<string> }) => {
        if (command !== "where.exe") return "registered";
        lookups.push(args.join(" "));
        if (args[0] === "$PATH:code")
          return `${join(repository, "code.exe")}
`;
        if (args[0] === "$PATH:cursor")
          return `${join(installed, "cursor.exe")}
`;
        throw new Error("missing");
      };
      await detectEditorApplications({ platform: "win32", runner: detect, repository });
      expect(EffectArray.sortWith(lookups, (value) => value, Order.String)).toEqual([
        "$PATH:code",
        "$PATH:code-insiders",
        "$PATH:cursor",
        "$PATH:explorer.exe",
        "$PATH:zed",
      ]);
      const launched: string[] = [];
      const launch = async ({ command }: { readonly command: string }) => (launched.push(command), "");
      await openInEditor({
        application: "vscode",
        platform: "win32",
        file: join(repository, "a.ts"),
        line: 1,
        column: 1,
        runner: launch,
      });
      await openInEditor({
        application: "cursor",
        platform: "win32",
        file: join(repository, "a.ts"),
        line: 1,
        column: 1,
        runner: launch,
      });
      expect(launched).toEqual(["rundll32.exe", join(installed, "cursor.exe")]);
    } finally {
      await detectEditorApplications({ platform: "test", runner: async () => "" });
      rmSync(repository, { recursive: true, force: true });
      rmSync(installed, { recursive: true, force: true });
    }
  });

  it("passes a pure allowlisted invocation to the runner", async () => {
    const runner = vi.fn<
      (invocation: { readonly command: string; readonly args: ReadonlyArray<string> }) => Promise<string>
    >(async () => "");
    await openInEditor({
      application: "cursor",
      platform: "linux",
      file: "/repo/a file.ts",
      line: 4,
      column: 5,
      runner,
    });
    expect(runner).toHaveBeenCalledWith({
      command: "xdg-open",
      args: ["cursor://file/repo/a%20file.ts:4:5"],
    });
  });
});
