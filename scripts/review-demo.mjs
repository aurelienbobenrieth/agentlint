#!/usr/bin/env node

/**
 * Open the review UI on a throwaway repository for manual QA. Run `pnpm build` first.
 *
 * Node scripts/review-demo.mjs [--port 4973] [--no-open]
 *
 * The repository has three findings: a whole-file change finding with related files and an agent proposal, a change
 * finding on a line range, and an agent-authority state finding.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

const decodeRecord = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.String,
      selector: Schema.optional(Schema.String),
      location: Schema.optional(Schema.Struct({ file: Schema.String })),
    }),
  ),
);

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repository, "packages", "agentlint");
const bin = join(packageRoot, "dist", "bin.mjs");
if (!existsSync(join(packageRoot, "dist", "ui", "index.html"))) {
  throw new Error("The review UI is not built. Run `pnpm build` first.");
}

const demo = mkdtempSync(join(tmpdir(), "agentlint-review-demo-"));
const write = (file, content) => {
  mkdirSync(dirname(join(demo, file)), { recursive: true });
  writeFileSync(join(demo, file), content);
};
const git = (...args) => execFileSync("git", args, { cwd: demo, stdio: "pipe" });
const agentlint = (...args) => execFileSync(process.execPath, [bin, ...args], { cwd: demo, stdio: "inherit" });

mkdirSync(join(demo, "node_modules", "@aurelienbbn"), { recursive: true });
symlinkSync(packageRoot, join(demo, "node_modules", "@aurelienbbn", "agentlint"), "junction");
write("package.json", `{ "name": "review-demo", "private": true, "type": "module" }\n`);
write(".gitignore", "node_modules/\n");

write(
  ".agentlint/config.ts",
  `import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

/**
 * One rule per guarantee, so its title, message and checks say what the guarantee is instead of pointing at it.
 */
const guaranteeRule = ({ id, title, area, standard, checks, files }) =>
  defineRule({
    lifecycle: "change",
    standard: { id, revision: 1, title, guidance: { standard, checks } },
    detector: {
      id: id + "/surface",
      version: 1,
      detect: ({ context }) => {
        const touched = context.change.files.filter((file) => files.some((prefix) => file.path.startsWith(prefix)));
        // A new file is usually why the guarantee is at stake; the other touched files are context.
        const primary = touched.find((file) => file.status === "added") ?? touched[0];
        if (primary === undefined) return;
        const firstHunk = primary.status === "added" ? undefined : primary.hunks[0];
        context.report({
          key: id,
          file: primary.path,
          message: "This change touches " + area + ".",
          evidence: touched.map((file) => file.path),
          relatedFiles: touched.filter((file) => file !== primary).map((file) => file.path),
          ...(firstHunk ? { startLine: firstHunk.newStart, endLine: firstHunk.newStart + firstHunk.newLines - 1 } : {}),
        });
      },
    },
    binding: { id, authority: "human", include: files.map((prefix) => prefix + "**") },
  });

const staffAccess = guaranteeRule({
  id: "ops/staff-access-fails-closed",
  title: "Staff access fails closed",
  area: "the staff access gate",
  standard: "Without a valid Access token for the stage's team, a request gets no page and no data.",
  checks: [
    "A request with a missing, expired or forged token is refused.",
    "A token from another team or audience is refused.",
    "An unknown role is treated as a viewer, never an operator.",
  ],
  files: ["apps/ops/", "packages/contracts/ops-rpc/"],
});

const jobLifecycle = guaranteeRule({
  id: "jobs/at-least-once",
  title: "Every accepted job runs at least once",
  area: "the job lifecycle",
  standard: "A job leaves queued or running only through an attempt's outcome, a retry, a lost-lease sweep, or a staff action.",
  checks: [
    "No new transition drops a queued or running job without one of those four causes.",
    "A refused transition leaves the job exactly as it was.",
  ],
  files: ["packages/jobs/"],
});

const boundedReads = defineRule({
  lifecycle: "state",
  standard: {
    id: "data/bounded-reads",
    revision: 1,
    title: "Production reads are bounded",
    guidance: { standard: "Reads that scale with production data have an explicit bound or pagination contract." },
  },
  detector: {
    id: "db/find-many-without-take",
    version: 1,
    match: { pattern: "$DB.findMany($$$ARGS)", where: { notHas: "take: $_" }, message: "$DB.findMany has no explicit bound." },
  },
  binding: { id: "data/bounded-reads", authority: "agent", include: ["apps/ops/src/reports/**/*.ts"] },
});

export default defineConfig({ base: "main", rules: [staffAccess, jobLifecycle, boundedReads] });
`,
);

write(
  "apps/ops/src/server/staff-access.ts",
  `import type { StaffIdentity } from "./staff-identity";

export const staffAccess = (identity: StaffIdentity | undefined) => {
  if (identity === undefined) return { allowed: false } as const;
  return { allowed: true, role: identity.role ?? "viewer" } as const;
};
`,
);
write(
  "apps/ops/src/server/staff-identity.ts",
  `export interface StaffIdentity {\n  readonly email: string;\n  readonly role?: "viewer" | "operator";\n}\n`,
);
write(
  "apps/ops/src/server/staff-session.ts",
  `export const sessionTtlSeconds = 60 * 60;\n\nexport const sessionCookie = "staff_session";\n`,
);
write(
  "packages/jobs/src/job-store/service.ts",
  `export type JobState = "queued" | "running" | "succeeded" | "failed";

export interface JobStore {
  readonly claim: (id: string) => Promise<boolean>;
  readonly complete: (id: string, outcome: "succeeded" | "failed") => Promise<void>;
}

export const transitions: Record<JobState, ReadonlyArray<JobState>> = {
  queued: ["running"],
  running: ["succeeded", "failed", "queued"],
  succeeded: [],
  failed: ["queued"],
};
`,
);
write("apps/ops/src/reports/audit.ts", `export const recentAudits = (db) => db.audit.findMany({ take: 50 });\n`);
write(
  "apps/ops/src/routes/staff.ts",
  `import { staffAccess } from "../server/staff-access";\n\nexport const staffRoute = { path: "/staff", guard: staffAccess };\n`,
);
write("packages/contracts/ops-rpc/src/staff.ts", `export interface StaffHeaders {\n  readonly email: string;\n}\n`);

git("init", "--quiet", "--initial-branch=main");
git("config", "user.email", "demo@example.com");
git("config", "user.name", "Review demo");
git("add", "-A");
git("commit", "--quiet", "-m", "base");
git("switch", "--quiet", "-c", "platform/foundation");

write(
  "apps/ops/src/server/access-signing-keys.ts",
  `import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

export interface AccessSigningKeys {
  readonly getKey: JWTVerifyGetKey;
}

/**
 * The Access team's JWKS, cached for ten minutes with a thirty-second refetch cooldown.
 */
export const remoteAccessSigningKeys = (team: string): AccessSigningKeys => ({
  getKey: createRemoteJWKSet(new URL(\`https://\${team}.cloudflareaccess.com/cdn-cgi/access/certs\`), {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
    timeoutDuration: 3 * 1000,
  }),
});
`,
);
write(
  "apps/ops/src/server/staff-access.ts",
  `import { jwtVerify } from "jose";
import type { AccessSigningKeys } from "./access-signing-keys";
import type { StaffIdentity } from "./staff-identity";

export const staffAccess = async (
  token: string | undefined,
  keys: AccessSigningKeys,
  verify: (token: string, keys: AccessSigningKeys) => Promise<StaffIdentity | undefined>,
) => {
  if (token === undefined) return { allowed: false } as const;
  const identity = await verify(token, keys).catch(() => undefined);
  if (identity === undefined) return { allowed: false } as const;
  return { allowed: true, role: identity.role ?? "viewer" } as const;
};

export const verifyAccessToken = async (token: string, keys: AccessSigningKeys): Promise<StaffIdentity> => {
  const { payload } = await jwtVerify(token, keys.getKey);
  return { email: String(payload["email"]) };
};
`,
);
write(
  "apps/ops/src/server/staff-session.ts",
  `export const sessionTtlSeconds = 30 * 60;\n\nexport const sessionCookie = "staff_session";\n`,
);
write(
  "packages/jobs/src/job-store/service.ts",
  `export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobStore {
  readonly claim: (id: string) => Promise<boolean>;
  readonly complete: (id: string, outcome: "succeeded" | "failed") => Promise<void>;
  readonly cancel: (id: string) => Promise<void>;
}

export const transitions: Record<JobState, ReadonlyArray<JobState>> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "queued", "cancelled"],
  succeeded: [],
  failed: ["queued"],
  cancelled: [],
};
`,
);
write(
  "apps/ops/src/reports/audit.ts",
  `export const recentAudits = (db) => db.audit.findMany({ where: { recent: true } });\n`,
);
write(
  "apps/ops/src/routes/staff.ts",
  `import { remoteAccessSigningKeys } from "../server/access-signing-keys";
import { staffAccess, verifyAccessToken } from "../server/staff-access";

const keys = remoteAccessSigningKeys("acme");

export const staffRoute = {
  path: "/staff",
  guard: (token: string | undefined) => staffAccess(token, keys, verifyAccessToken),
};
`,
);
write(
  "packages/contracts/ops-rpc/src/staff.ts",
  `export interface StaffHeaders {\n  readonly email: string;\n  readonly role: "viewer" | "operator";\n}\n`,
);
write(
  "apps/ops/test/staff-access.test.ts",
  `import { expect, it } from "vitest";
import { staffAccess } from "../src/server/staff-access";

it("refuses a token no key verifies", async () => {
  const keys = { getKey: async () => undefined };
  expect(await staffAccess("forged", keys, async () => undefined)).toEqual({ allowed: false });
});
`,
);

// `check` exits 1 while findings are unresolved, which is the point here.
const { stdout } = spawnSync(process.execPath, [bin, "check", "--all", "--format", "jsonl"], {
  cwd: demo,
  encoding: "utf8",
});
const selectorFor = (file) => {
  const finding = stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => decodeRecord(line))
    .find((record) => record.type === "finding" && record.location?.file === file);
  if (finding === undefined) throw new Error(`The demo expected a finding on ${file}.`);
  return finding.selector;
};

agentlint(
  "propose",
  selectorFor("apps/ops/src/server/access-signing-keys.ts"),
  "--summary",
  [
    "Changed: new access-signing-keys.ts loads the team's JWKS (10 min cache, 3 s timeout).",
    "Holds: a token no key verifies is refused at staff-access.ts:12; staff-access.test.ts covers it.",
    "Check: the JWKS URL uses the stage's own team.",
  ].join("\n"),
);
write(
  "cancel.diff",
  `--- a/packages/jobs/src/job-store/service.ts
+++ b/packages/jobs/src/job-store/service.ts
@@ -14,5 +14,5 @@
   succeeded: [],
   failed: ["queued"],
-  cancelled: [],
+  cancelled: ["queued"],
 };
`,
);
agentlint(
  "propose",
  selectorFor("packages/jobs/src/job-store/service.ts"),
  "--summary",
  [
    "Changed: adds a cancelled state staff can set on a queued or running job.",
    "Holds: cancelling is a staff action, one of the four allowed ways out of queued or running.",
    "Check: whether a cancelled job may be requeued; the proposed diff allows it.",
  ].join("\n"),
  "--diff-file",
  "cancel.diff",
);

const passthrough = process.argv.slice(2);
console.log(`\nDemo repository: ${demo}\n`);
spawn(process.execPath, [bin, "review", ...passthrough], { cwd: demo, stdio: "inherit" }).on("exit", (code) => {
  process.exitCode = code ?? 0;
});
