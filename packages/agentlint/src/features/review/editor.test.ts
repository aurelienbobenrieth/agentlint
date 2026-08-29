import { describe, expect, it, vi } from "vitest";
import { detectEditorApplications, editorInvocation, launcherFromLookup, openInEditor } from "./editor.js";

describe("review editor adapters", () => {
  it("keeps a Windows file target in one allowlisted argument", () => {
    expect(editorInvocation("vscode", "win32", String.raw`C:\work tree\démo.ts`, 7, 3)).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "vscode://file/C:/work%20tree/d%C3%A9mo.ts:7:3"],
    });
    expect(editorInvocation("explorer", "win32", String.raw`C:\work tree\démo.ts`, 7, 3)).toEqual({
      command: "explorer.exe",
      args: [String.raw`/select,C:\work tree\démo.ts`],
    });
  });

  it("uses platform launchers without a shell", () => {
    expect(editorInvocation("zed", "darwin", "/work tree/demo.ts", 2, 9)).toEqual({
      command: "open",
      args: ["zed://file/work%20tree/demo.ts:2:9"],
    });
    expect(editorInvocation("explorer", "linux", "/work tree/demo.ts", 2, 9)).toEqual({
      command: "xdg-open",
      args: ["/work tree"],
    });
  });

  it("prefers a command-line launcher and resolves Windows shims to the executable", () => {
    expect(
      editorInvocation("cursor", "win32", String.raw`C:\repo\a.ts`, 4, 5, String.raw`C:\Apps\cursor\Cursor.exe`),
    ).toEqual({
      command: String.raw`C:\Apps\cursor\Cursor.exe`,
      args: ["--goto", String.raw`C:\repo\a.ts:4:5`],
    });
    expect(editorInvocation("zed", "linux", "/repo/a.ts", 4, 5, "/usr/bin/zed")).toEqual({
      command: "/usr/bin/zed",
      args: ["/repo/a.ts:4:5"],
    });
    const cursor = { windowsExecutable: (shim: string) => `${shim}${String.raw`\..\Cursor.exe`}` };
    expect(
      launcherFromLookup(
        cursor,
        "win32",
        `${String.raw`C:\Apps\cursor\bin\cursor`}\r\n${String.raw`C:\Apps\cursor\bin\cursor.cmd`}\r\n`,
      ),
    ).toBe(String.raw`C:\Apps\cursor\bin\..\Cursor.exe`);
    expect(
      launcherFromLookup(
        cursor,
        "win32",
        `${String.raw`C:\Apps\Zed\bin\zed`}\r\n${String.raw`C:\Apps\Zed\bin\Zed.exe`}\r\n`,
      ),
    ).toBe(String.raw`C:\Apps\Zed\bin\Zed.exe`);
    expect(launcherFromLookup(cursor, "darwin", "/usr/local/bin/cursor\n")).toBe("/usr/local/bin/cursor");
  });

  it("reports only applications whose handlers are detected", async () => {
    const runner = vi.fn<
      (invocation: { readonly command: string; readonly args: ReadonlyArray<string> }) => Promise<string>
    >(async ({ args }) => {
      if (args.some((arg) => arg.includes("vscode") || arg === "explorer.exe")) return "available";
      throw new Error("missing");
    });
    await expect(detectEditorApplications("win32", runner)).resolves.toEqual([
      { id: "vscode", label: "VS Code" },
      { id: "vscode-insiders", label: "VS Code Insiders" },
      { id: "explorer", label: "File Explorer" },
    ]);
  });

  it("passes a pure allowlisted invocation to the runner", async () => {
    const runner = vi.fn<
      (invocation: { readonly command: string; readonly args: ReadonlyArray<string> }) => Promise<string>
    >(async () => "");
    await openInEditor("cursor", "linux", "/repo/a file.ts", 4, 5, runner);
    expect(runner).toHaveBeenCalledWith({
      command: "xdg-open",
      args: ["cursor://file/repo/a%20file.ts:4:5"],
    });
  });
});
