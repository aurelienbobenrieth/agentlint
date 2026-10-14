import { expect, test } from "@playwright/test";

const state = {
  version: 4,
  changes: {},
  sources: {
    "src/query.ts": "import { db } from './db';\n\nexport const users = () =>\n  db.user.findMany();\n",
    "policy/query-bounds.md": "Production queries use a limit, cursor, or documented finite boundary.\n",
    "src/query-contract.ts": "export const maximumPageSize = 100;\n",
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
      relatedFiles: ["policy/query-bounds.md", "src/query-contract.ts", "src/query.ts"],
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

test("accepts an attached finding without reloading the page", async ({ page }) => {
  let accepted = false;
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        transport: "attached",
        detached: null,
        findings: state.findings.map((finding) => ({
          ...finding,
          status: accepted ? "accepted" : "unresolved",
          acceptance: accepted
            ? {
                reason: "The tenant has a verified finite bound.",
                actor: "human:local-review",
                authority: "human",
                at: "2026-10-14T12:00:00.000Z",
              }
            : null,
        })),
      },
    }),
  );
  await page.route("**/api/action", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      type: "accept",
      findingId: "finding-1",
      reason: "The tenant has a verified finite bound.",
    });
    accepted = true;
    await route.fulfill({ json: { ok: true, message: "Accepted the query." } });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Reason or requested change" })
    .fill("The tenant has a verified finite bound.");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving…", exact: true })).toHaveCount(0);
  await expect(page.getByText("Accepted the query.", { exact: true })).toBeVisible();
});

test("advances while acceptance is pending and restores a rejected finding", async ({ page }) => {
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        transport: "attached",
        detached: null,
        findings: [
          state.findings[0],
          { ...state.findings[0], id: "finding-2", line: 5, message: "Second query to review." },
        ],
      },
    }),
  );
  await page.route("**/api/action", async (route) => {
    await response;
    await route.fulfill({ status: 409, json: { ok: false, message: "The finding changed. Refresh the review." } });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Reason or requested change" }).fill("A verified finite bound.");
  const posted = page.waitForRequest("**/api/action");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await posted;
  try {
    await expect(page.getByRole("main").getByText("Second query to review.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Saving…", exact: true })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Reason or requested change" }).fill("Another verified bound.");
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByText("Decision rejected: The finding changed. Refresh the review.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Review this unbounded query/ })).toBeVisible();
});

test("switches repeatedly between changed lines and the full file", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        changes: {
          "src/query.ts": {
            status: "modified",
            previousPath: null,
            hunks: [
              {
                oldStart: 3,
                newStart: 3,
                lines: [
                  { kind: "context", content: "export const users = () =>" },
                  { kind: "deletion", content: "  db.user.findMany({ take: 100 });" },
                  { kind: "addition", content: "  db.user.findMany();" },
                ],
              },
            ],
          },
        },
      },
    }),
  );
  await page.goto("/");
  const code = page.locator(".code__lines");
  const toggleViews = async () => {
    await expect(code.locator(".line--gap")).toHaveText("⋯ line 3");
    await expect(code.locator(".line--deletion .line__c")).toHaveText("  db.user.findMany({ take: 100 });");
    await expect(code.locator(".line--addition .line__c")).toHaveText("  db.user.findMany();");
    await page.getByRole("button", { name: "Full file · 5 lines" }).click();
    await expect(code.locator(".line__c")).toHaveText([
      "import { db } from './db';",
      " ",
      "export const users = () =>",
      "  db.user.findMany();",
      " ",
    ]);
    await expect(code.locator(".line--gap, .line--deletion, .line--addition")).toHaveCount(0);
    await page.getByRole("button", { name: "Changes only", exact: true }).click();
  };
  await toggleViews();
  await toggleViews();
  await toggleViews();
  await expect(page.getByRole("heading", { name: "Bound database queries" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("loads a review, supports keyboard help, and remains contained on mobile", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Bound database queries" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Review this unbounded query.", { exact: true })).toBeVisible();
  const files = page.getByRole("complementary", { name: "Files to review together" });
  await expect(files.getByRole("button", { name: "query.ts Flagged file" })).toBeVisible();
  await files.getByRole("button", { name: "policy", exact: true }).click();
  await expect(files.getByRole("button", { name: "query-bounds.md" })).toHaveCount(0);
  await files.getByRole("button", { name: "policy", exact: true }).click();
  await files.getByRole("button", { name: "query-bounds.md" }).click();
  await expect(page.getByText("Production queries use a limit, cursor, or documented finite boundary.")).toBeVisible();
  await files.getByRole("button", { name: "query-contract.ts" }).click();
  await expect(page.getByText("export const maximumPageSize = 100;")).toBeVisible();

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
