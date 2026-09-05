import { defineConfig, defineRule, type ChangeHunk } from "@aurelienbbn/agentlint";

/** Working-tree line number of the hunk line at `index`. */
const newLineAt = (hunk: ChangeHunk, index: number): number =>
  hunk.newStart + hunk.lines.slice(0, index).filter((line) => line.kind !== "deletion").length;

const boundedQueries = defineRule({
  lifecycle: "state",
  standard: {
    id: "data/bounded-queries",
    revision: 1,
    title: "Production queries have a growth bound",
    guidance: {
      standard: "Queries that scale with production data use a limit, cursor, or documented finite boundary.",
      checks: [
        "A hard limit, pagination contract, or proven finite tenant boundary can satisfy the standard.",
        "Internal jobs still need a deliberate batch size so retries and memory use stay predictable.",
      ],
      examples: [{ label: "Explicit limit", code: "db.users.findMany({ take: 50 })" }],
      refs: [{ type: "url", href: "https://www.prisma.io/docs/orm/prisma-client/queries/pagination" }],
    },
  },
  detector: {
    id: "prisma/find-many-without-take",
    version: 1,
    match: {
      pattern: "$DB.findMany($$$ARGS)",
      where: { notHas: "take: $_" },
      message: "$DB has no explicit query bound.",
    },
    fixtures: {
      mustReport: ["db.users.findMany({ where: { active: true } })"],
      mustStaySilent: ["db.users.findMany({ take: 50 })"],
    },
  },
  binding: {
    id: "data/bounded-queries",
    authority: "agent",
    include: ["src/**/*.{ts,tsx}"],
    exclude: ["**/*.test.ts"],
  },
});

const idempotentPaymentCapture = defineRule({
  lifecycle: "state",
  standard: {
    id: "payments/idempotent-capture",
    revision: 1,
    title: "Payment captures are safe to retry",
    guidance: {
      standard: "Every payment capture supplies a stable idempotency key derived from the business operation.",
      checks: [
        "Confirm the key is stable across retries and unique across distinct purchases.",
        "A request-scoped random value does not satisfy the standard.",
      ],
      examples: [
        {
          label: "Order identity survives retries",
          code: "payments.capture({ orderId, amount, idempotencyKey: `order:${orderId}` })",
        },
      ],
      refs: [{ type: "url", href: "https://docs.stripe.com/api/idempotent_requests" }],
    },
  },
  detector: {
    id: "typescript/payment-capture-without-idempotency-key",
    version: 1,
    match: {
      pattern: "$CLIENT.capture($$$ARGS)",
      where: { notHas: "idempotencyKey: $_" },
      message: "Payment capture has no explicit idempotency key.",
    },
    fixtures: {
      mustReport: ["payments.capture({ orderId, amount })"],
      mustStaySilent: ["payments.capture({ orderId, amount, idempotencyKey: `order:${orderId}` })"],
    },
  },
  binding: {
    id: "payments/idempotent-capture",
    authority: "agent",
    include: ["src/payments/**/*.ts"],
  },
});

const focusedTests = defineRule({
  lifecycle: "state",
  standard: {
    id: "testing/no-focused-tests",
    revision: 1,
    title: "Focused tests never reach a shared branch",
    guidance: {
      standard: "Committed test suites execute the complete selected test scope rather than a local-only focused case.",
      checks: ["Remove .only before handing work off; use the test runner's CLI filter for local iteration."],
      examples: [{ label: "Normal test", code: 'it("lists active users", async () => { /* … */ })' }],
    },
  },
  detector: {
    id: "typescript/focused-test",
    version: 1,
    match: {
      pattern: "it.only($$$ARGS)",
      message: "Focused test would exclude the rest of the suite.",
    },
    fixtures: {
      mustReport: ['it.only("works", () => {})'],
      mustStaySilent: ['it("works", () => {})'],
    },
  },
  binding: {
    id: "testing/no-focused-tests",
    authority: "agent",
    include: ["src/**/*.{test,spec}.ts"],
  },
});

const dynamicCodeExecution = defineRule({
  lifecycle: "state",
  standard: {
    id: "security/dynamic-code-execution",
    revision: 1,
    title: "Dynamic code execution has an explicit trust boundary",
    guidance: {
      standard:
        "Code assembled from runtime input is never executed without a documented, human-reviewed trust boundary.",
      checks: [
        "Prefer a constrained parser or an allowlisted expression interpreter.",
        "If execution is unavoidable, prove the input provenance, isolation boundary, and failure containment.",
      ],
      examples: [{ label: "Constrained evaluator", code: "formulaEngine.evaluate(expression, { allowedFunctions })" }],
      refs: [{ type: "url", href: "https://owasp.org/www-community/attacks/Code_Injection" }],
    },
  },
  detector: {
    id: "javascript/eval-call",
    version: 1,
    match: {
      pattern: "eval($_)",
      message: "Runtime input reaches dynamic code execution.",
    },
    fixtures: {
      mustReport: [{ file: "fixture.js", source: "eval(expression)" }],
      mustStaySilent: [{ file: "fixture.js", source: "formulaEngine.evaluate(expression)" }],
    },
  },
  binding: {
    id: "security/dynamic-code-execution",
    authority: "human",
    include: ["src/**/*.{js,ts}"],
  },
});

const destructiveMigrations = defineRule({
  lifecycle: "change",
  standard: {
    id: "database/destructive-migrations",
    revision: 1,
    title: "Destructive migrations receive human review",
    guidance: {
      standard: "Destructive schema changes include a verified backfill, rollback, and deployment sequence.",
      checks: ["Verify expand/backfill/contract ordering and a tested restoration path."],
      examples: [{ code: "// Deploy expansion, backfill and verify, then contract in a later release." }],
      refs: [{ type: "url", href: "https://martinfowler.com/articles/evodb.html" }],
    },
  },
  detector: {
    id: "text/destructive-schema-addition",
    version: 1,
    detect(context) {
      for (const file of context.change.files) {
        for (const hunk of file.hunks) {
          const index = hunk.lines.findIndex(
            (candidate) =>
              candidate.kind === "addition" && /drop(?:Table|Column)|DROP\s+(?:TABLE|COLUMN)/i.test(candidate.content),
          );
          const line = hunk.lines[index];
          if (!line) continue;
          context.report({
            key: `${file.path}:destructive-schema`,
            lineageKey: `${file.path}:destructive-schema`,
            file: file.path,
            message: "This change adds a destructive schema operation.",
            evidence: { operation: line.content.trim() },
            excerpt: line.content,
            startLine: newLineAt(hunk, index),
          });
        }
      }
    },
    fixtures: {
      mustReport: [{ before: {}, after: { "migration.ts": 'db.dropTable("legacy_users")' } }],
      mustStaySilent: [{ before: {}, after: { "migration.ts": 'db.createTable("users")' } }],
    },
  },
  binding: {
    id: "database/destructive-migrations",
    authority: "human",
    include: ["src/migrations/**"],
  },
});

const privilegeWidening = defineRule({
  lifecycle: "change",
  standard: {
    id: "authorization/privilege-widening",
    revision: 1,
    title: "Privilege widening is deliberate and reviewable",
    guidance: {
      standard: "New administrative access paths carry a narrow scope, an authorization test, and a named reviewer.",
      checks: [
        "Trace the permission from transport through policy enforcement to the protected operation.",
        "Verify that the default role remains least-privileged.",
      ],
      examples: [{ code: "const canManageBilling = policy.allows(actor, 'billing:manage', account)" }],
    },
  },
  detector: {
    id: "diff/administrative-role-addition",
    version: 1,
    detect(context) {
      for (const file of context.change.files) {
        for (const hunk of file.hunks) {
          let ordinal = 0;
          for (const [index, line] of hunk.lines.entries()) {
            if (line.kind !== "addition" || !/role:\s*["']admin["']|isAdmin:\s*true/.test(line.content)) continue;
            context.report({
              key: `${file.path}:admin-access:${ordinal}`,
              lineageKey: `${file.path}:admin-access`,
              file: file.path,
              message: "This change introduces an administrative access path.",
              evidence: { addition: line.content.trim() },
              excerpt: line.content,
              startLine: newLineAt(hunk, index),
            });
            ordinal++;
          }
        }
      }
    },
    fixtures: {
      mustReport: [{ before: {}, after: { "route.ts": 'createUser({ role: "admin" })' } }],
      mustStaySilent: [{ before: {}, after: { "route.ts": 'createUser({ role: "member" })' } }],
    },
  },
  binding: {
    id: "authorization/privilege-widening",
    authority: "human",
    include: ["src/api/**", "src/pages/**"],
  },
});

export default defineConfig({
  rules: [
    boundedQueries,
    idempotentPaymentCapture,
    focusedTests,
    dynamicCodeExecution,
    destructiveMigrations,
    privilegeWidening,
  ],
});
