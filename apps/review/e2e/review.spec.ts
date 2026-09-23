import { expect, test } from "@playwright/test";

const state = {
  version: 3,
  sources: {
    "src/query.ts": "import { db } from './db';\n\nexport const users = () =>\n  db.user.findMany();\n",
    "policy/query-bounds.md": "Production queries use a limit, cursor, or documented finite boundary.\n",
  },
  coverage: { scope: "complete", files: ["src/query.ts"], rules: ["data/bounded-query"] },
  mode: "review",
  transport: "detached",
  project: "browser-smoke",
  base: "main",
  generatedAt: "2026-08-10T00:00:00.000Z",
  applications: [],
  calibration: [],
  detached: { source: "review.json" },
  findings: [
    {
      id: "finding-1",
      identity: {
        source: {
          standardId: "data/bounded-query",
          standardRevision: 1,
          detectorId: "prisma/find-many",
          detectorVersion: 1,
          bindingId: "app/database",
          bindingDigest: "binding-digest",
        },
        fingerprint: { scheme: "source-structure", version: 2, digest: "finding-digest" },
        lineageKey: null,
      },
      ruleId: "data/bounded-query",
      ruleTitle: "Bound database queries",
      lifecycle: "state",
      authority: "human",
      file: "src/query.ts",
      line: 4,
      column: 3,
      message: "Review this unbounded query.",
      relatedFiles: ["policy/query-bounds.md", "src/query.ts"],
      invalidationReasons: [],
      editor: null,
      code: { focus: { startLine: 4, startColumn: 3, endLine: 4, endColumn: 21 } },
      guidance: {
        summary: null,
        standard: "Bound the result set.",
        checks: [],
        examples: [],
        references: [],
      },
      status: "unresolved",
      acceptance: null,
      lineageReason: null,
      proposal: null,
    },
  ],
} as const;

test.beforeEach(async ({ page }) => {
  await page.route("**/api/state", (route) => route.fulfill({ json: state }));
});

test("loads a review, supports keyboard help, and remains contained on mobile", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Bound database queries" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Review this unbounded query.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Related review context" })).toBeVisible();
  await page.getByText("policy/query-bounds.md", { exact: true }).click();
  await expect(page.getByText("Production queries use a limit, cursor, or documented finite boundary.")).toBeVisible();

  await page.keyboard.press("?");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts.getByText("Next finding", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shortcuts).not.toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Bound database queries" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
