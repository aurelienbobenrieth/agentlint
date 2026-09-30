/**
 * Process boundary for deterministic, read-only Git commands. @module
 */

import { execFile, spawn } from "node:child_process";
import { Effect, Schema } from "effect";

/**
 * Largest Git output accepted by the adapter.
 */
export const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

const GIT_TIMEOUT_MS = 120_000;

export interface GitCommandFailure {
  readonly exitCode: number | undefined;
  readonly code: string | undefined;
  readonly detail: string;
}

const GitCommandFailureSchema = Schema.Struct({
  exitCode: Schema.UndefinedOr(Schema.Number),
  code: Schema.UndefinedOr(Schema.String),
  detail: Schema.String,
});

const isNumber = Schema.is(Schema.Number);
const isString = Schema.is(Schema.String);

interface GitInvocation {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly literalPathspecs: boolean;
  readonly variables?: Readonly<NodeJS.ProcessEnv>;
}

const gitArguments = ({ args, literalPathspecs }: Pick<GitInvocation, "args" | "literalPathspecs">) => [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "color.ui=false",
  "-c",
  "diff.algorithm=myers",
  "-c",
  "diff.indentHeuristic=false",
  // User settings that would otherwise change hunk text or boundaries for the same repository state.
  "-c",
  "diff.suppressBlankEmpty=false",
  "-c",
  "diff.interHunkContext=0",
  "-c",
  "diff.renameLimit=1000",
  "--no-optional-locks",
  ...(literalPathspecs ? ["--literal-pathspecs"] : []),
  ...args,
];

const processEnvironment = (variables: Readonly<NodeJS.ProcessEnv> | undefined) =>
  variables ? { ...variables, LANG: "C", LC_ALL: "C" } : undefined;

// A process can also fail synchronously (e.g. an invalid argument); keep that a typed failure too.
const toFailure = (failure: unknown): GitCommandFailure =>
  Schema.is(GitCommandFailureSchema)(failure)
    ? failure
    : {
        exitCode: undefined,
        code: undefined,
        detail: failure instanceof Error ? failure.message : String(failure),
      };

export const runGitCommand = ({
  cwd,
  args,
  literalPathspecs,
  variables,
}: GitInvocation): Effect.Effect<string, GitCommandFailure> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          gitArguments({ args, literalPathspecs }),
          {
            cwd,
            encoding: "utf8",
            maxBuffer: GIT_MAX_BUFFER_BYTES,
            windowsHide: true,
            signal,
            timeout: GIT_TIMEOUT_MS,
            env: processEnvironment(variables),
          },
          (error, stdout, stderr) => {
            if (!error) return resolve(stdout);
            reject({
              exitCode: isNumber(error.code) ? error.code : undefined,
              code: isString(error.code) ? error.code : undefined,
              detail: stderr.trim() || error.message,
            } satisfies GitCommandFailure);
          },
        );
      }),
    catch: toFailure,
  });

/**
 * One object read through `git cat-file --batch`: its bytes, or `undefined` when it is larger than the adapter accepts.
 */
export type GitObjectContent = { readonly _tag: "Loaded"; readonly bytes: Buffer } | { readonly _tag: "TooLarge" };

/**
 * Reads streamed `cat-file --batch` output: a `<id> <type> <size>` header, the object bytes, and a newline per object,
 * or `<id> missing`. Objects above `maxBytes` are skipped without being buffered.
 */
const catFileBatchReader = ({ maxBytes }: { readonly maxBytes: number }) => {
  const objects: Array<GitObjectContent | undefined> = [];
  const state: {
    pending: Buffer;
    body: { remaining: number; chunks: Buffer[] | undefined } | undefined;
  } = { pending: Buffer.alloc(0), body: undefined };
  const push = (chunk: Buffer): void => {
    state.pending = state.pending.length === 0 ? chunk : Buffer.concat([state.pending, chunk]);
    for (;;) {
      if (state.body) {
        // The body is followed by one newline, consumed with it.
        const take = Math.min(state.body.remaining, state.pending.length);
        state.body.chunks?.push(state.pending.subarray(0, take));
        state.body.remaining -= take;
        state.pending = state.pending.subarray(take);
        if (state.body.remaining > 0) return;
        const chunks = state.body.chunks;
        objects.push(chunks ? { _tag: "Loaded", bytes: Buffer.concat(chunks).subarray(0, -1) } : { _tag: "TooLarge" });
        state.body = undefined;
        continue;
      }
      const newline = state.pending.indexOf(0x0a);
      if (newline < 0) return;
      const header = state.pending.subarray(0, newline).toString("latin1");
      state.pending = state.pending.subarray(newline + 1);
      const size = /^[0-9a-f]+ [a-z]+ (\d+)$/.exec(header)?.[1];
      if (size === undefined) {
        objects.push(undefined);
        continue;
      }
      const bytes = Number(size);
      state.body = { remaining: bytes + 1, chunks: bytes > maxBytes ? undefined : [] };
    }
  };
  return { push, objects };
};

/**
 * Read many objects through one `git cat-file --batch` process fed on stdin. The result is aligned with `ids`; a
 * missing object is `undefined`.
 */
export const readGitObjects = ({
  cwd,
  ids,
  variables,
  maxBytes = GIT_MAX_BUFFER_BYTES,
}: {
  readonly cwd: string;
  readonly ids: ReadonlyArray<string>;
  readonly variables?: Readonly<NodeJS.ProcessEnv>;
  readonly maxBytes?: number;
}): Effect.Effect<ReadonlyArray<GitObjectContent | undefined>, GitCommandFailure> =>
  ids.length === 0
    ? Effect.succeed([])
    : Effect.tryPromise({
        try: (signal) =>
          new Promise<ReadonlyArray<GitObjectContent | undefined>>((resolve, reject) => {
            const reader = catFileBatchReader({ maxBytes });
            const stderr: Buffer[] = [];
            const settled = { done: false };
            const fail = (failure: GitCommandFailure) => {
              if (settled.done) return;
              settled.done = true;
              child.kill();
              reject(failure);
            };
            const child = spawn("git", gitArguments({ args: ["cat-file", "--batch"], literalPathspecs: false }), {
              cwd,
              windowsHide: true,
              signal,
              timeout: GIT_TIMEOUT_MS,
              env: processEnvironment(variables),
              stdio: ["pipe", "pipe", "pipe"],
            });
            child.stdout.on("data", (chunk: Buffer) => reader.push(chunk));
            child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
            child.on("error", (error: NodeJS.ErrnoException) =>
              fail({ exitCode: undefined, code: error.code, detail: error.message }),
            );
            // A failed process closes stdin early; the exit status reports the failure.
            child.stdin.on("error", () => undefined);
            child.on("close", (exitCode, exitSignal) => {
              if (settled.done) return;
              if (exitCode !== 0 || reader.objects.length !== ids.length)
                return fail({
                  exitCode: exitCode ?? undefined,
                  code: exitSignal ?? undefined,
                  detail:
                    Buffer.concat(stderr).toString("utf8").trim() ||
                    `git cat-file --batch answered ${reader.objects.length} of ${ids.length} objects`,
                });
              settled.done = true;
              resolve(reader.objects);
            });
            child.stdin.end(`${ids.join("\n")}\n`);
          }),
        catch: toFailure,
      });
