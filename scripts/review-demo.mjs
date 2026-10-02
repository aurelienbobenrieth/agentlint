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

const guarantees = {
  "ops/staff-access-fails-closed": {
    files: ["apps/ops/src/server/"],
    statement:
      "Staff access fails closed: a request without a valid Access token for the stage's team and audience gets no page and no data; a missing or unknown role is a viewer, never an operator.",
  },
  "jobs/at-least-once-lifecycle": {
    files: ["packages/jobs/"],
    statement:
      "Every accepted job runs at least once: it leaves queued or running only through an attempt's outcome, a retry, the sweep of a lost lease, or a staff action.",
  },
};

const namedGuarantees = defineRule({
  lifecycle: "change",
  standard: {
    id: "repo/named-guarantees",
    revision: 1,
    title: "Named guarantees change only by a human decision",
    guidance: {
      standard:
        "A change to a surface that holds one of the repository's named guarantees keeps that guarantee, and a human checked it.",
      checks: ["The guarantee still holds on every path the change touches.", "A test covers the refusal path."],
    },
  },
  detector: {
    id: "repo/guarantee-surface",
    version: 1,
    detect: ({ context }) => {
      for (const [id, guarantee] of Object.entries(guarantees)) {
        const touched = context.change.files.filter((file) =>
          guarantee.files.some((prefix) => file.path.startsWith(prefix)),
        );
        const [primary, ...related] = touched;
        if (primary === undefined) continue;
        const firstHunk = primary.status === "added" ? undefined : primary.hunks[0];
        context.report({
          key: id,
          file: primary.path,
          message: \`Protected invariant \\\`\${id}\\\` is affected: \${guarantee.statement}\`,
          evidence: touched.map((file) => file.path),
          relatedFiles: related.map((file) => file.path),
          ...(firstHunk ? { startLine: firstHunk.newStart, endLine: firstHunk.newStart + firstHunk.newLines - 1 } : {}),
        });
      }
    },
  },
  binding: { id: "repo/named-guarantees", authority: "human", include: ["apps/**", "packages/**"] },
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
  binding: { id: "data/bounded-reads", authority: "agent", include: ["apps/**/*.ts"] },
});

export default defineConfig({ base: "main", rules: [namedGuarantees, boundedReads] });
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
  `import type { AccessSigningKeys } from "./access-signing-keys";
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
  "New file: loads Access signing keys from the team's JWKS URL (10 min cache, 3 s timeout). Fails closed: a token no key verifies is refused in staff-access.ts:10. Check the JWKS URL is the stage's own team.",
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
  "Adds a cancelled state that staff can set on a queued or running job. Still at least once: cancel is a staff action, which the guarantee allows. Decide whether a cancelled job may be requeued; the diff allows it.",
  "--diff-file",
  "cancel.diff",
);

const passthrough = process.argv.slice(2);
console.log(`\nDemo repository: ${demo}\n`);
spawn(process.execPath, [bin, "review", ...passthrough], { cwd: demo, stdio: "inherit" }).on("exit", (code) => {
  process.exitCode = code ?? 0;
});
