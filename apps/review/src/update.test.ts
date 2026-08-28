import { describe, expect, it } from "vitest";

import {
  ClickedAccept,
  ClickedFinish,
  ClickedCopyFindingContext,
  ClickedOpenFinding,
  ClickedDismissToast,
  ClickedRequestChanges,
  ClickedWithdraw,
  CompletedUtility,
  HoveredToasts,
  LeftToasts,
  ExpiredToast,
  PreparedDetachedFinish,
  PreparedDecision,
  RemovedToast,
  SelectedEditorApplication,
  SelectedCalibration,
  PressedShortcut,
  UpdatedNote,
  UpdatedReason,
} from "./message";
import { persistedReview, Reviewing, type Model } from "./model";
import type { ReviewStatePayload } from "./types";
import { agentInstructions, findingContext, update } from "./update";
import { effectiveFindingStatus } from "./selection";
import { shortcutFor } from "./shortcuts";

const state = (mode: "calibration" | "review"): ReviewStatePayload => ({
  version: 1,
  mode,
  transport: "detached",
  project: "demo",
  base: "main",
  generatedAt: "2026-08-10T00:00:00.000Z",
  applications: [],
  detached: { source: "review.json", canPersistAcceptances: false },
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
        fingerprint: { scheme: "ast", version: 1, digest: "finding-digest" },
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
      editor: null,
      code: {
        source: "import { db } from './db';\n\nexport const users = () =>\n  db.user.findMany();\n",
        focus: { startLine: 4, startColumn: 3, endLine: 4, endColumn: 21 },
      },
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
});

const model = (mode: "calibration" | "review"): Model => ({
  screen: Reviewing({ state: state(mode) }),
  view: "queue",
  facets: { statuses: [], authorities: [], lifecycles: [], ruleIds: [] },
  groupBy: "file",
  codeView: "focused",
  guidanceOpen: false,
  sidebarOpen: true,
  sidebarWidth: 300,
  resizingSidebar: false,
  preferredApplication: null,
  query: "",
  selectedFindingId: "finding-1",
  drafts: {},
  busyFindingId: null,
  helpOpen: false,
  toastsPaused: false,
  modKey: "Ctrl",
  toasts: [],
  nextToastId: 1,
  saveState: "idle",
});

const send = (current: Model, message: Parameters<typeof update>[1]): Model => update(current, message)[0];

describe("review stories", () => {
  it("keeps calibration feedback temporary and copyable", () => {
    let current = model("calibration");
    current = send(current, SelectedCalibration({ findingId: "finding-1", calibration: "does_not_apply" }));
    current = send(current, UpdatedNote({ findingId: "finding-1", value: "Ignore generated clients." }));

    expect(agentInstructions(current)).toContain("does_not_apply");
    expect(agentInstructions(current)).toContain("Ignore generated clients.");
    expect(current.drafts["finding-1"]?.disposition).toBe("none");
  });

  it("exports full identity for a detached acceptance", () => {
    let current = model("review");
    current = send(current, UpdatedReason({ findingId: "finding-1", value: "The query is capped upstream." }));
    current = send(current, ClickedAccept({ findingId: "finding-1" }));
    if (current.screen._tag !== "Reviewing") throw new Error("Expected the review screen.");
    const finding = current.screen.state.findings.find(({ id }) => id === "finding-1");
    if (finding === undefined) throw new Error("Expected the fixture finding.");
    expect(effectiveFindingStatus(finding, current.screen.state, current)).toBe("accepted");
    current = send(current, ClickedFinish());
    current = send(current, PreparedDetachedFinish({ acceptedAt: "2026-08-10T18:00:00.000Z" }));

    if (current.screen._tag !== "Finished") throw new Error("Expected the finished screen.");
    expect(current.screen.acceptanceOutput).toContain("binding-digest");
    expect(current.screen.acceptanceOutput).toContain("The query is capped upstream.");
    expect(current.screen.acceptanceOutput).toContain('"schemaVersion":1');
    expect(current.screen.acceptanceOutput).toContain('"authority":"human"');
  });

  it("turns requested changes into an agent handoff", () => {
    let current = model("review");
    current = send(current, UpdatedReason({ findingId: "finding-1", value: "Add a hard limit of 100 rows." }));
    current = send(current, ClickedRequestChanges({ findingId: "finding-1" }));

    expect(agentInstructions(current)).toContain("Add a hard limit of 100 rows.");
  });

  it("prepares contextual finding actions without resolving the gate", () => {
    const current = send(model("review"), PreparedDecision({ findingId: "finding-1", intent: "request_changes" }));

    expect(current.selectedFindingId).toBe("finding-1");
    expect(current.toasts.at(-1)?.message).toContain("coding agent");
    expect(current.drafts["finding-1"]?.disposition).toBeUndefined();
  });

  it("copies complete, paste-ready context for a finding", () => {
    let current = model("review");
    current = send(current, UpdatedReason({ findingId: "finding-1", value: "Add a hard limit of 100 rows." }));
    if (current.screen._tag !== "Reviewing") throw new Error("Expected the review screen.");
    const finding = current.screen.state.findings[0];
    if (finding === undefined) throw new Error("Expected a finding.");
    const content = findingContext(finding, current);

    expect(content).toContain("# agentlint finding: Bound database queries");
    expect(content).toContain("Review this unbounded query.");
    expect(content).toContain("## Focused code context");
    expect(content).toContain("db.user.findMany()");
    expect(content).toContain("Add a hard limit of 100 rows.");
    expect(content).toContain('"bindingDigest": "binding-digest"');

    const [, commands] = update(current, ClickedCopyFindingContext({ findingId: "finding-1" }));
    expect(commands).toHaveLength(1);
  });

  it("persists a detected editor choice and opens through the local server", () => {
    const current = model("review");
    if (current.screen._tag !== "Reviewing") throw new Error("Expected the review screen.");
    const attached: Model = {
      ...current,
      screen: Reviewing({
        state: {
          ...current.screen.state,
          transport: "attached",
          detached: null,
          applications: [{ id: "vscode", label: "VS Code" }],
          findings: current.screen.state.findings.map((finding) => ({ ...finding, editor: { canOpen: true } })),
        },
      }),
    };
    const [selected, selectedCommands] = update(
      attached,
      SelectedEditorApplication({ findingId: "finding-1", application: "vscode" }),
    );
    expect(selected.preferredApplication).toBe("vscode");
    expect(selectedCommands).toHaveLength(2);

    const [, commands] = update(selected, ClickedOpenFinding({ findingId: "finding-1" }));
    expect(commands).toHaveLength(1);

    const [updated, noCommands] = update(model("review"), ClickedOpenFinding({ findingId: "finding-1" }));
    expect(noCommands).toHaveLength(1);
    expect(updated.toasts.at(-1)?.message).toContain("Choose");
  });

  it("stacks at most five independently expiring toasts", () => {
    let current = model("review");
    for (const message of ["First", "Second", "Third", "Fourth", "Fifth"]) {
      current = send(current, CompletedUtility({ message, tone: "success" }));
    }
    const [updated, commands] = update(current, CompletedUtility({ message: "Sixth", tone: "neutral" }));

    expect(updated.toasts.map(({ message }) => message)).toEqual(["Second", "Third", "Fourth", "Fifth", "Sixth"]);
    expect(updated.toasts.map(({ id }) => id)).toEqual([2, 3, 4, 5, 6]);
    expect(updated.nextToastId).toBe(7);
    expect(commands).toHaveLength(1);
  });

  it("withdraws a staged decision so the reviewer can change their mind", () => {
    let current = model("review");
    current = send(current, UpdatedReason({ findingId: "finding-1", value: "Cap it at 100." }));
    current = send(current, ClickedRequestChanges({ findingId: "finding-1" }));
    expect(current.drafts["finding-1"]?.disposition).toBe("request_changes");
    current = send(current, ClickedWithdraw({ findingId: "finding-1" }));
    expect(current.drafts["finding-1"]?.disposition).toBe("none");
    expect(current.drafts["finding-1"]?.reason).toBe("Cap it at 100.");
  });

  it("pauses toast expiry while the stack is hovered", () => {
    let current = send(model("review"), CompletedUtility({ message: "Saved", tone: "success" }));
    current = send(current, HoveredToasts());
    const [paused, commands] = update(current, ExpiredToast({ id: 1 }));
    expect(paused.toasts[0]?.phase).toBe("visible");
    expect(commands).toHaveLength(1);
    current = send(paused, LeftToasts());
    expect(send(current, ExpiredToast({ id: 1 })).toasts[0]?.phase).toBe("leaving");
  });

  it("dismisses the newest toast with X", () => {
    let current = model("review");
    current = send(current, CompletedUtility({ message: "One", tone: "success" }));
    current = send(current, CompletedUtility({ message: "Two", tone: "success" }));
    const [leaving] = update(current, PressedShortcut({ action: "dismiss_toast" }));
    expect(leaving.toasts.map(({ phase }) => phase)).toEqual(["visible", "leaving"]);
  });

  it("keeps danger toasts until manually dismissed", () => {
    const [failed, expiryCommands] = update(
      model("review"),
      CompletedUtility({ message: "Clipboard unavailable", tone: "danger" }),
    );
    expect(expiryCommands).toHaveLength(0);
    expect(failed.toasts[0]).toMatchObject({ tone: "danger", phase: "visible" });

    const id = failed.toasts[0]?.id;
    if (id === undefined) throw new Error("Expected a toast.");
    const [leaving, removalCommands] = update(failed, ClickedDismissToast({ id }));
    expect(leaving.toasts[0]?.phase).toBe("leaving");
    expect(removalCommands).toHaveLength(1);

    const removed = send(leaving, RemovedToast({ id }));
    expect(removed.toasts).toEqual([]);
  });

  it("expires the matching toast through its leaving phase", () => {
    let current = model("review");
    current = send(current, CompletedUtility({ message: "One", tone: "success" }));
    current = send(current, CompletedUtility({ message: "Two", tone: "success" }));

    const [leaving, commands] = update(current, ExpiredToast({ id: 1 }));
    expect(leaving.toasts.map(({ phase }) => phase)).toEqual(["leaving", "visible"]);
    expect(commands).toHaveLength(1);
    expect(send(leaving, RemovedToast({ id: 1 })).toasts.map(({ message }) => message)).toEqual(["Two"]);
  });

  it("maps Linear-style keys outside inputs and chords inside them", () => {
    const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, editable: false };
    expect(shortcutFor({ ...plain, key: "j" })).toBe("next");
    expect(shortcutFor({ ...plain, key: "ArrowUp" })).toBe("previous");
    expect(shortcutFor({ ...plain, key: "a" })).toBe("accept");
    expect(shortcutFor({ ...plain, key: "?" })).toBe("help");
    expect(shortcutFor({ ...plain, key: "a", editable: true })).toBeNull();
    expect(shortcutFor({ ...plain, key: "Enter", ctrlKey: true, editable: true })).toBe("accept");
    expect(shortcutFor({ ...plain, key: "Enter", metaKey: true, shiftKey: true, editable: true })).toBe(
      "request_changes",
    );
    expect(shortcutFor({ ...plain, key: "Escape", editable: true })).toBe("escape");
    expect(shortcutFor({ ...plain, key: "j", ctrlKey: true })).toBeNull();
  });

  it("focuses the reason before accepting from the keyboard, then accepts", () => {
    const [focused, focusCommands] = update(model("review"), PressedShortcut({ action: "accept" }));
    expect(focused.drafts["finding-1"]).toBeUndefined();
    expect(focusCommands).toHaveLength(1);

    let current = send(model("review"), UpdatedReason({ findingId: "finding-1", value: "Capped upstream." }));
    current = send(current, PressedShortcut({ action: "accept" }));
    expect(current.drafts["finding-1"]?.disposition).toBe("accept");
  });

  it("toggles help and closes it with escape", () => {
    const opened = send(model("review"), PressedShortcut({ action: "help" }));
    expect(opened.helpOpen).toBe(true);
    expect(send(opened, PressedShortcut({ action: "next" })).selectedFindingId).toBe("finding-1");
    expect(send(opened, PressedShortcut({ action: "escape" })).helpOpen).toBe(false);
  });

  it("keeps transient toast state out of persisted reviews", () => {
    const current = send(model("review"), CompletedUtility({ message: "Saved", tone: "success" }));
    const persisted = persistedReview(current);

    expect(current.toasts).toHaveLength(1);
    expect(persisted).not.toHaveProperty("toasts");
    expect(persisted).not.toHaveProperty("nextToastId");
  });
});
