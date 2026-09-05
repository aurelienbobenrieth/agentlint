/** Safe, allowlisted launch adapters for live review sessions. @module @since 0.2.0 */

import { execFile } from "node:child_process";
import { posix, win32 } from "node:path";
import type { EditorApplication, EditorApplicationId } from "./contract.js";

interface Invocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

type Runner = (invocation: Invocation) => Promise<string>;

interface ApplicationSpec extends EditorApplication {
  readonly scheme?: string;
  readonly macName?: string;
  /** Command-line entry point, when the application ships one. */
  readonly cli?: string;
  /** Windows-only: how the `.cmd` shim found on PATH maps to the real executable. */
  readonly windowsExecutable?: (shimDirectory: string) => string;
}

const APPLICATIONS: ReadonlyArray<ApplicationSpec> = [
  {
    id: "cursor",
    label: "Cursor",
    scheme: "cursor",
    macName: "Cursor",
    cli: "cursor",
    windowsExecutable: (shim) => win32.resolve(shim, "..", "..", "..", "Cursor.exe"),
  },
  {
    id: "vscode",
    label: "VS Code",
    scheme: "vscode",
    macName: "Visual Studio Code",
    cli: "code",
    windowsExecutable: (shim) => win32.resolve(shim, "..", "Code.exe"),
  },
  {
    id: "vscode-insiders",
    label: "VS Code Insiders",
    scheme: "vscode-insiders",
    macName: "Visual Studio Code - Insiders",
    cli: "code-insiders",
    windowsExecutable: (shim) => win32.resolve(shim, "..", "Code - Insiders.exe"),
  },
  {
    id: "zed",
    label: "Zed",
    scheme: "zed",
    macName: "Zed",
    cli: "zed",
    windowsExecutable: (shim) => win32.resolve(shim, "Zed.exe"),
  },
  { id: "explorer", label: "File Explorer" },
];

/**
 * `explorer.exe` reports exit code 1 even when it opened the target, so only a
 * failed spawn counts as an error there.
 */
const run: Runner = ({ command, args }) =>
  new Promise((settle, reject) => {
    execFile(command, [...args], { windowsHide: true }, (error, stdout) => {
      const spawnFailed = error !== null && "code" in error && error.code === "ENOENT";
      if (error && (spawnFailed || !command.endsWith("explorer.exe"))) reject(error);
      else settle(stdout);
    });
  });

/** Command-line launchers confirmed by the last detection, keyed by application. */
const launchers = new Map<EditorApplicationId, string>();

/**
 * `scheme://file/<path>:line:column`. The path separator and the drive letter
 * follow the target platform, never the platform running the server, so the
 * mapping stays deterministic in tests and in a detached review.
 */
function editorUri(
  application: Exclude<EditorApplicationId, "explorer">,
  platform: string,
  file: string,
  line: number,
  column: number,
) {
  const absolute = platform === "win32" ? win32.resolve(file).replaceAll("\\", "/") : posix.resolve(file);
  const pathname = absolute
    .split("/")
    .map((segment, index) => (index === 0 && platform === "win32" ? segment : encodeURIComponent(segment)))
    .join("/");
  return `${application}://file${platform === "win32" ? `/${pathname}` : pathname}:${line}:${column}`;
}

/** Pure adapter mapping, exported so argument boundaries can be regression-tested. */
export function editorInvocation(
  application: EditorApplicationId,
  platform: string,
  file: string,
  line: number,
  column: number,
  launcher?: string,
): Invocation {
  if (application === "explorer") {
    return platform === "win32"
      ? { command: "explorer.exe", args: [`/select,${file}`] }
      : platform === "darwin"
        ? { command: "open", args: ["-R", file] }
        : { command: "xdg-open", args: [posix.dirname(file)] };
  }

  // A real CLI takes the position as one argument and never loses it, unlike a
  // scheme handler that some platforms rewrite on the way through.
  if (launcher !== undefined) {
    const target = `${file}:${line}:${column}`;
    return application === "zed"
      ? { command: launcher, args: [target] }
      : { command: launcher, args: ["--goto", target] };
  }

  const uri = editorUri(application, platform, file, line, column);
  return platform === "win32"
    ? { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", uri] }
    : platform === "darwin"
      ? { command: "open", args: [uri] }
      : { command: "xdg-open", args: [uri] };
}

function detectionInvocation(application: ApplicationSpec, platform: string): Invocation | undefined {
  if (application.id === "explorer") {
    return platform === "win32"
      ? { command: "where.exe", args: ["explorer.exe"] }
      : platform === "darwin"
        ? { command: "which", args: ["open"] }
        : { command: "which", args: ["xdg-open"] };
  }
  return platform === "win32"
    ? { command: "reg.exe", args: ["query", `HKCR\\${application.scheme}`] }
    : platform === "darwin"
      ? { command: "open", args: ["-Ra", application.macName ?? application.label] }
      : { command: "xdg-mime", args: ["query", "default", `x-scheme-handler/${application.scheme}`] };
}

/** Resolve the `where`/`which` output to something `execFile` can spawn without a shell. */
export function launcherFromLookup(
  application: Pick<ApplicationSpec, "windowsExecutable">,
  platform: string,
  output: string,
): string | undefined {
  const candidates = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (platform !== "win32") return candidates[0];
  const executable = candidates.find((candidate) => /\.exe$/iu.test(candidate));
  if (executable) return executable;
  const shim = candidates.find((candidate) => /\.cmd$/iu.test(candidate)) ?? candidates[0];
  return shim && application.windowsExecutable ? application.windowsExecutable(win32.dirname(shim)) : undefined;
}

export async function detectEditorApplications(
  platform: string,
  runner: Runner = run,
): Promise<ReadonlyArray<EditorApplication>> {
  launchers.clear();
  const detected = await Promise.all(
    APPLICATIONS.map(async (application) => {
      const invocation = detectionInvocation(application, platform);
      if (!invocation) return undefined;
      let viaScheme = false;
      try {
        const output = await runner(invocation);
        viaScheme = !(platform === "linux" && application.id !== "explorer" && output.trim() === "");
      } catch {
        viaScheme = false;
      }
      let viaCli = false;
      if (application.cli) {
        try {
          const output = await runner(
            platform === "win32"
              ? { command: "where.exe", args: [application.cli] }
              : { command: "which", args: [application.cli] },
          );
          const launcher = launcherFromLookup(application, platform, output);
          if (launcher) {
            launchers.set(application.id, launcher);
            viaCli = true;
          }
        } catch {
          viaCli = false;
        }
      }
      return viaScheme || viaCli
        ? ({ id: application.id, label: application.label } satisfies EditorApplication)
        : undefined;
    }),
  );
  return detected.filter((application): application is EditorApplication => application !== undefined);
}

export async function openInEditor(
  application: EditorApplicationId,
  platform: string,
  file: string,
  line: number,
  column: number,
  runner: Runner = run,
): Promise<void> {
  await runner(editorInvocation(application, platform, file, line, column, launchers.get(application)));
}
