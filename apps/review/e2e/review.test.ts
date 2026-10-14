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

test("keeps a pending card in place while another card is actionable and restores a rejection", async ({ page }) => {
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
  const first = page.locator("#finding-finding-1");
  const second = page.locator("#finding-finding-2");
  await first.getByRole("textbox", { name: "Reason or requested change" }).fill("A verified finite bound.");
  const posted = page.waitForRequest("**/api/action");
  await first.getByRole("button", { name: "Accept", exact: true }).click();
  await posted;
  try {
    await expect(page.getByRole("main").getByText("Second query to review.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Saving…", exact: true })).toHaveCount(0);
    await expect(first.getByText("Accepted", { exact: true })).toBeVisible();
    await second.getByRole("textbox", { name: "Reason or requested change" }).fill("Another verified bound.");
    await expect(second.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByText("Decision rejected: The finding changed. Refresh the review.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Review this unbounded query/ })).toBeVisible();
  await expect(first.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
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

test("reviews a file once with folded context and editable inline decisions", async ({ page }) => {
  const first = state.findings[0];
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        sources: { "src/query.ts": Array.from({ length: 418 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n") },
        findings: [
          {
            ...first,
            line: 263,
            relatedFiles: ["src/query.ts"],
            code: { focus: { startLine: 263, startColumn: 1, endLine: 267, endColumn: 20 } },
            proposal: {
              summary: "This query has no bound. Keep it: the caller caps the input to ten users.",
              diff: null,
              actor: "agent:codex",
              at: state.generatedAt,
            },
          },
          {
            ...first,
            id: "finding-2",
            ruleId: "data/other",
            ruleTitle: "Review the second query",
            line: 350,
            relatedFiles: ["src/query.ts"],
            code: { focus: { startLine: 350, startColumn: 1, endLine: 350, endColumn: 20 } },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".code")).toHaveCount(1);
  await expect(page.locator(".inline-finding")).toHaveCount(2);
  await expect(page.getByText("const line263 = 263;", { exact: true })).toBeVisible();
  await expect(page.getByText("const line350 = 350;", { exact: true })).toBeVisible();
  await expect(page.getByText("const line1 = 1;", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Bound the result set.", { exact: true }).first()).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Full file · 418 lines" })).toHaveCount(0);
  await expect(page.getByText("const line1 = 1;", { exact: true })).toHaveCount(0);
  const fold = page.locator(".code-fold").first();
  await expect(fold.getByRole("button")).toHaveCount(1);
  await expect(fold.locator("svg")).toHaveCount(1);
  await page.getByRole("button", { name: "259 lines hidden Show all", exact: true }).click();
  await expect(page.getByText("const line259 = 259;", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse 259 lines", exact: true }).click();
  await expect(page.getByText("const line259 = 259;", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all code" }).click();
  await expect(page.getByText("const line1 = 1;", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse unchanged code" }).click();
  const firstCard = page.locator(".inline-finding").first();
  await firstCard.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(firstCard.getByRole("button", { name: "Edit decision" })).toBeVisible();
  await expect(page.locator(".inline-finding")).toHaveCount(2);
  await expect(page.getByText("const line263 = 263;", { exact: true })).toBeVisible();
  await firstCard.getByRole("button", { name: "Edit decision" }).click();
  await firstCard.getByRole("button", { name: "Request changes", exact: true }).click();
  await expect(firstCard.getByText("Changes requested", { exact: true })).toBeVisible();
  await page.locator(".row").filter({ hasText: "Review the second query" }).click();
  const secondCard = page.locator(".inline-finding").last();
  await expect(secondCard).toBeInViewport();
  await expect(secondCard.getByRole("button", { name: "Accept", exact: true })).toBeDisabled();
  await secondCard.getByRole("textbox", { name: "Reason or requested change" }).fill("The input is finite.");
  await secondCard.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(secondCard.getByRole("button", { name: "Edit decision" })).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.locator("#filter-menu").getByRole("button", { name: "Bound database queries", exact: false }).click();
  await expect(page.locator(".inline-finding")).toHaveCount(1);
});

test("keyboard decisions follow the focused inline card and keep criteria optional", async ({ page }) => {
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        findings: [state.findings[0], { ...state.findings[0], id: "finding-2", ruleTitle: "Another rule" }],
      },
    }),
  );
  await page.goto("/");
  const cards = page.locator(".inline-finding");
  await cards.last().getByRole("textbox", { name: "Reason or requested change" }).fill("The caller caps this query.");
  await page.keyboard.press("Control+Enter");
  await expect(cards.last().getByRole("button", { name: "Edit decision" })).toBeVisible();
  await expect(cards.first().getByRole("button", { name: "Accept", exact: true })).toBeDisabled();
  await cards.first().locator("summary").filter({ hasText: "Details" }).click();
  await expect(cards.first().getByText("Bound the result set.", { exact: true })).toBeVisible();
  await expect(cards.last().getByText("Bound the result set.", { exact: true })).toHaveCount(0);
});

test("keeps a server-confirmed decision in the file and reuses its recorded reason", async ({ page }) => {
  let accepted = false;
  const requests: unknown[] = [];
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        transport: "attached",
        detached: null,
        findings: [
          {
            ...state.findings[0],
            status: accepted ? "accepted" : "unresolved",
            acceptance: accepted
              ? {
                  authority: "human",
                  actor: "human:reviewer",
                  reason: "The caller caps this query.",
                  at: state.generatedAt,
                }
              : null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/action", (route) => {
    const request = route.request().postDataJSON();
    requests.push(request);
    accepted = request.type === "accept";
    return route.fulfill({ json: { message: "Saved." } });
  });
  await page.goto("/");
  const card = page.locator(".inline-finding");
  await card.getByRole("textbox", { name: "Reason or requested change" }).fill("The caller caps this query.");
  await card.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(card.getByRole("button", { name: "Edit decision" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue 0", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Edit decision" }).click();
  await expect(card.getByRole("textbox", { name: "Reason or requested change" })).toHaveValue(
    "The caller caps this query.",
  );
  await card.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(card.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  expect(requests).toEqual([
    { type: "accept", findingId: "finding-1", reason: "The caller caps this query." },
    { type: "withdraw", findingId: "finding-1" },
  ]);
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

test("keeps a finding outside diff hunks visible in both code views", async ({ page }) => {
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        sources: { "src/query.ts": Array.from({ length: 60 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n") },
        changes: {
          "src/query.ts": {
            status: "modified",
            previousPath: null,
            hunks: [
              {
                oldStart: 10,
                newStart: 10,
                lines: [
                  { kind: "deletion", content: "const line10 = 0;" },
                  { kind: "addition", content: "const line10 = 10;" },
                ],
              },
            ],
          },
        },
        findings: [
          {
            ...state.findings[0],
            line: 50,
            code: { focus: { startLine: 50, startColumn: 1, endLine: 50, endColumn: 20 } },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("const line50 = 50;", { exact: true })).toBeVisible();
  await expect(page.locator(".line--deletion")).toHaveText("10const line10 = 0;");
  await expect(page.getByText("const line30 = 30;", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Full file · 60 lines" }).click();
  await expect(page.getByText("const line50 = 50;", { exact: true })).toBeVisible();
  await expect(page.locator(".line--deletion")).toHaveCount(0);
});

test("independent review hides the inline recommendation until an assessment is written", async ({ page }) => {
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        findings: [
          {
            ...state.findings[0],
            proposal: {
              summary: "The caller bounds the query.",
              diff: null,
              actor: "agent:codex",
              at: state.generatedAt,
            },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Independent review", exact: true }).click();
  await expect(page.getByText("The caller bounds the query.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Independent assessment" }).fill("The input has a finite maximum.");
  await page.getByRole("button", { name: "Reveal prior decisions", exact: true }).click();
  await expect(page.getByText("The caller bounds the query.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reason or requested change" })).toHaveValue(
    "The input has a finite maximum.",
  );
});

test("shows deleted file evidence once", async ({ page }) => {
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        sources: { "src/query.ts": "const users = [];\nexport { users };\n" },
        changes: {
          "src/query.ts": {
            status: "deleted",
            previousPath: null,
            hunks: [
              {
                oldStart: 1,
                newStart: 0,
                lines: [
                  { kind: "deletion", content: "const users = [];" },
                  { kind: "deletion", content: "export { users };" },
                ],
              },
            ],
          },
        },
        findings: [{ ...state.findings[0], lifecycle: "change", code: { focus: null } }],
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".line--deletion .line__c")).toHaveText(["const users = [];", "export { users };"]);
  await expect(page.locator(".line--context")).toHaveCount(0);
  await expect(page.locator(".inline-finding")).toHaveCount(1);
});

test("folds a long added hunk around the finding instead of showing the entire file", async ({ page }) => {
  const source = Array.from({ length: 100 }, (_, index) => `const item${index + 1} = ${index + 1};`);
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        sources: { "src/query.ts": source.join("\n") },
        changes: {
          "src/query.ts": {
            status: "added",
            previousPath: null,
            hunks: [{ oldStart: 0, newStart: 1, lines: source.map((content) => ({ kind: "addition", content })) }],
          },
        },
        findings: [
          {
            ...state.findings[0],
            line: 50,
            code: { focus: { startLine: 50, startColumn: 1, endLine: 50, endColumn: 20 } },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("const item50 = 50;", { exact: true })).toBeVisible();
  await expect(page.getByText("const item20 = 20;", { exact: true })).toHaveCount(0);
  await expect(page.getByText("const item80 = 80;", { exact: true })).toHaveCount(0);
});
