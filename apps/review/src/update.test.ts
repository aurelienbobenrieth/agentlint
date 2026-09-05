import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { agentInstructions, detachedOutput } from "./features/decision/selectors";
import { findingContext } from "./features/detail/selectors";
import { shortcutFor } from "./features/shortcuts/subscription";
import { Message } from "./message";
import { persistedReview, Screen, type Model } from "./model";
import { deriveReview, effectiveFindingStatus } from "./shared/selectors";
import { update } from "./update";

const state = (mode: "calibration" | "review"): ReviewStatePayload => ({
  version: 2,
  sources: { "src/query.ts": "import { db } from './db';\n\nexport const users = () =>\n  db.user.findMany();\n" },
  coverage: { scope: "complete", files: ["src/query.ts"], rules: ["data/bounded-query"] },
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
      editor: null,
      code: {
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
  screen: Screen.Reviewing({ state: state(mode) }),
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
  saveVersion: 0,
});

const send = (current: Model, message: Message): Model => update(current, message).model;

const reviewing = (current: Model): ReviewStatePayload => {
  if (current.screen._tag !== "Reviewing") throw new Error("Expected the review screen.");
  return current.screen.state;
};

describe("review stories", () => {
  it("keeps calibration feedback temporary and copyable", () => {
    let current = model("calibration");
    current = send(current, Message.SelectedCalibration({ findingId: "finding-1", calibration: "does_not_apply" }));
    expect(deriveReview(reviewing(current), current).queueCount).toBe(1);
    current = send(current, Message.ClickedSaveCalibration({ findingId: "finding-1" }));
    expect(deriveReview(reviewing(current), current).queueCount).toBe(0);
    current = send(current, Message.UpdatedNote({ findingId: "finding-1", value: "Ignore generated clients." }));

    expect(agentInstructions(current)).toContain("does_not_apply");
    expect(agentInstructions(current)).toContain("Ignore generated clients.");
    expect(detachedOutput(current, "2026-09-05T12:00:00.000Z").acceptanceOutput).toBe("");
  });

  it("exports full identity for a detached acceptance", () => {
    let current = model("review");
    current = send(current, Message.UpdatedReason({ findingId: "finding-1", value: "The query is capped upstream." }));
    current = send(current, Message.ClickedAccept({ findingId: "finding-1" }));
    const finding = reviewing(current).findings.find(({ id }) => id === "finding-1");
    if (finding === undefined) throw new Error("Expected the fixture finding.");
    expect(effectiveFindingStatus(finding, reviewing(current), current)).toBe("accepted");
    current = send(current, Message.ClickedFinish());
    current = send(current, Message.PreparedDetachedFinish({ acceptedAt: "2026-08-10T18:00:00.000Z" }));

    if (current.screen._tag !== "Finished") throw new Error("Expected the finished screen.");
    expect(current.screen.acceptanceOutput).toContain("binding-digest");
    expect(current.screen.acceptanceOutput).toContain("The query is capped upstream.");
    expect(current.screen.acceptanceOutput).toContain('"schemaVersion":1');
    expect(current.screen.acceptanceOutput).toContain('"authority":"human"');
  });

  it("turns requested changes into an agent handoff", () => {
    let current = model("review");
    current = send(current, Message.UpdatedReason({ findingId: "finding-1", value: "Add a hard limit of 100 rows." }));
    current = send(current, Message.ClickedRequestChanges({ findingId: "finding-1" }));

    expect(agentInstructions(current)).toContain("Add a hard limit of 100 rows.");
  });

  it("debounces persistence while typing and writes only for the latest edit", () => {
    const first = update(model("review"), Message.UpdatedReason({ findingId: "finding-1", value: "Cap" }));
    expect(first.model.drafts["finding-1"]?.reason).toBe("Cap");
    expect(first.model.saveState).toBe("saving");
    expect(first.commands ?? []).toHaveLength(1);

    const second = update(first.model, Message.UpdatedReason({ findingId: "finding-1", value: "Capped" }));
    expect(second.model.saveVersion).toBe(2);

    const stale = update(second.model, Message.ElapsedPersistDelay({ version: 1 }));
    expect(stale.commands ?? []).toHaveLength(0);

    const latest = update(second.model, Message.ElapsedPersistDelay({ version: 2 }));
    expect(latest.commands ?? []).toHaveLength(1);
    expect(latest.commands?.[0]?.name).toBe("PersistReview");
  });

  it("copies complete, paste-ready context for a finding", () => {
    let current = model("review");
    current = send(current, Message.UpdatedReason({ findingId: "finding-1", value: "Add a hard limit of 100 rows." }));
    const finding = reviewing(current).findings[0];
    if (finding === undefined) throw new Error("Expected a finding.");
    const content = findingContext(finding, current);

    expect(content).toContain("# agentlint finding: Bound database queries");
    expect(content).toContain("Review this unbounded query.");
    expect(content).toContain("## Focused code context");
    expect(content).toContain("db.user.findMany()");
    expect(content).toContain("Add a hard limit of 100 rows.");
    expect(content).toContain('"bindingDigest": "binding-digest"');

    const copy = update(current, Message.ClickedCopyFindingContext({ findingId: "finding-1" }));
    expect(copy.commands ?? []).toHaveLength(1);
  });

  it("persists a detected editor choice and opens through the local server", () => {
    const current = model("review");
    const attached: Model = {
      ...current,
      screen: Screen.Reviewing({
        state: {
          ...reviewing(current),
          transport: "attached",
          detached: null,
          applications: [{ id: "vscode", label: "VS Code" }],
          findings: reviewing(current).findings.map((finding) => ({ ...finding, editor: { canOpen: true } })),
        },
      }),
    };
    const selection = update(
      attached,
      Message.SelectedEditorApplication({ findingId: "finding-1", application: "vscode" }),
    );
    expect(selection.model.preferredApplication).toBe("vscode");
    expect(selection.commands ?? []).toHaveLength(2);

    const open = update(selection.model, Message.ClickedOpenFinding({ findingId: "finding-1" }));
    expect(open.commands ?? []).toHaveLength(1);

    const unavailable = update(model("review"), Message.ClickedOpenFinding({ findingId: "finding-1" }));
    expect(unavailable.commands ?? []).toHaveLength(1);
    expect(unavailable.model.toasts.at(-1)?.message).toContain("Choose");
  });

  it("stacks at most five independently expiring toasts", () => {
    let current = model("review");
    for (const message of ["First", "Second", "Third", "Fourth", "Fifth"]) {
      current = send(current, Message.CompletedUtility({ message, tone: "success" }));
    }
    const sixth = update(current, Message.CompletedUtility({ message: "Sixth", tone: "neutral" }));

    expect(sixth.model.toasts.map(({ message }) => message)).toEqual(["Second", "Third", "Fourth", "Fifth", "Sixth"]);
    expect(sixth.model.toasts.map(({ id }) => id)).toEqual([2, 3, 4, 5, 6]);
    expect(sixth.model.nextToastId).toBe(7);
    expect(sixth.commands ?? []).toHaveLength(1);
  });

  it("withdraws a staged decision so the reviewer can change their mind", () => {
    let current = model("review");
    current = send(current, Message.UpdatedReason({ findingId: "finding-1", value: "Cap it at 100." }));
    current = send(current, Message.ClickedRequestChanges({ findingId: "finding-1" }));
    expect(current.drafts["finding-1"]?.disposition).toBe("request_changes");
    current = send(current, Message.ClickedWithdraw({ findingId: "finding-1" }));
    expect(current.drafts["finding-1"]?.disposition).toBe("none");
    expect(current.drafts["finding-1"]?.reason).toBe("Cap it at 100.");
  });

  it("pauses toast expiry while the stack is hovered", () => {
    let current = send(model("review"), Message.CompletedUtility({ message: "Saved", tone: "success" }));
    current = send(current, Message.HoveredToasts());
    const paused = update(current, Message.ExpiredToast({ id: 1 }));
    expect(paused.model.toasts[0]?.phase).toBe("visible");
    expect(paused.commands ?? []).toHaveLength(1);
    current = send(paused.model, Message.LeftToasts());
    expect(send(current, Message.ExpiredToast({ id: 1 })).toasts[0]?.phase).toBe("leaving");
  });

  it("dismisses the newest toast with X", () => {
    let current = model("review");
    current = send(current, Message.CompletedUtility({ message: "One", tone: "success" }));
    current = send(current, Message.CompletedUtility({ message: "Two", tone: "success" }));
    const leaving = send(current, Message.PressedShortcut({ action: "dismiss_toast" }));
    expect(leaving.toasts.map(({ phase }) => phase)).toEqual(["visible", "leaving"]);
  });

  it("keeps danger toasts until manually dismissed", () => {
    const failed = update(
      model("review"),
      Message.CompletedUtility({ message: "Clipboard unavailable", tone: "danger" }),
    );
    expect(failed.commands ?? []).toHaveLength(0);
    expect(failed.model.toasts[0]).toMatchObject({ tone: "danger", phase: "visible" });

    const id = failed.model.toasts[0]?.id;
    if (id === undefined) throw new Error("Expected a toast.");
    const leaving = update(failed.model, Message.ClickedDismissToast({ id }));
    expect(leaving.model.toasts[0]?.phase).toBe("leaving");
    expect(leaving.commands ?? []).toHaveLength(1);

    const removed = send(leaving.model, Message.RemovedToast({ id }));
    expect(removed.toasts).toEqual([]);
  });

  it("expires the matching toast through its leaving phase", () => {
    let current = model("review");
    current = send(current, Message.CompletedUtility({ message: "One", tone: "success" }));
    current = send(current, Message.CompletedUtility({ message: "Two", tone: "success" }));

    const leaving = update(current, Message.ExpiredToast({ id: 1 }));
    expect(leaving.model.toasts.map(({ phase }) => phase)).toEqual(["leaving", "visible"]);
    expect(leaving.commands ?? []).toHaveLength(1);
    expect(send(leaving.model, Message.RemovedToast({ id: 1 })).toasts.map(({ message }) => message)).toEqual(["Two"]);
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
    const focus = update(model("review"), Message.PressedShortcut({ action: "accept" }));
    expect(focus.model.drafts["finding-1"]).toBeUndefined();
    expect(focus.commands ?? []).toHaveLength(1);

    let current = send(model("review"), Message.UpdatedReason({ findingId: "finding-1", value: "Capped upstream." }));
    current = send(current, Message.PressedShortcut({ action: "accept" }));
    expect(current.drafts["finding-1"]?.disposition).toBe("accept");
  });

  it("toggles help and closes it with escape", () => {
    const opened = send(model("review"), Message.PressedShortcut({ action: "help" }));
    expect(opened.helpOpen).toBe(true);
    expect(send(opened, Message.PressedShortcut({ action: "next" })).selectedFindingId).toBe("finding-1");
    expect(send(opened, Message.PressedShortcut({ action: "escape" })).helpOpen).toBe(false);
  });

  it("keeps transient toast state out of persisted reviews", () => {
    const current = send(model("review"), Message.CompletedUtility({ message: "Saved", tone: "success" }));
    const persisted = persistedReview(current);

    expect(current.toasts).toHaveLength(1);
    expect(persisted).not.toHaveProperty("toasts");
    expect(persisted).not.toHaveProperty("nextToastId");
  });

  it("derives the review once per model change and moves accepted findings to Decisions", () => {
    const current = model("review");
    const before = deriveReview(reviewing(current), current);
    expect(deriveReview(reviewing(current), current)).toBe(before);
    expect(before.queueCount).toBe(1);
    expect(before.openCount).toBe(1);
    expect(before.selected?.id).toBe("finding-1");
    expect(before.counts.rules.get("data/bounded-query")).toBe(1);

    let accepted = send(current, Message.UpdatedReason({ findingId: "finding-1", value: "Capped." }));
    accepted = send(accepted, Message.ClickedAccept({ findingId: "finding-1" }));
    const after = deriveReview(reviewing(accepted), accepted);
    expect(after).not.toBe(before);
    expect(after.queueCount).toBe(0);
    expect(after.decisionsCount).toBe(1);
    expect(after.openCount).toBe(0);
    expect(after.visible).toEqual([]);
  });
});

describe("review gate and detached revocations", () => {
  it("keeps requested changes unresolved and exports a conditional revocation", () => {
    const initial = model("review");
    const payload = state("review");
    const findings = payload.findings.map((finding) => ({
      ...finding,
      status: "accepted" as const,
      acceptance: {
        reason: "Previously examined",
        actor: "human:reviewer",
        authority: "human" as const,
        at: "2026-09-05T12:00:00.000Z",
      },
    }));
    const start = { ...initial, screen: Screen.Reviewing({ state: { ...payload, findings } }) };
    const result = update(start, Message.ClickedRequestChanges({ findingId: "finding-1" }));
    if (result.model.screen._tag !== "Reviewing") throw new Error("Expected review");
    const derived = deriveReview(result.model.screen.state, result.model);
    expect(derived.openCount).toBe(1);
    expect(derived.undecidedCount).toBe(0);
    const output = detachedOutput(result.model, "2026-09-05T13:00:00.000Z");
    expect(
      Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({ type: Schema.String, expectedReason: Schema.String, expectedAcceptedAt: Schema.String }),
        ),
      )(output.acceptanceOutput),
    ).toMatchObject({
      type: "revoke",
      expectedReason: "Previously examined",
      expectedAcceptedAt: "2026-09-05T12:00:00.000Z",
    });
  });
});

describe("attached action confirmation", () => {
  it("keeps failed requests out of decisions and blocks concurrent submits and finish", () => {
    const current = model("review");
    const attached = {
      ...current,
      screen: Screen.Reviewing({ state: { ...state("review"), transport: "attached" as const, detached: null } }),
    };
    const pending = send(attached, Message.ClickedRequestChanges({ findingId: "finding-1" }));
    expect(pending.busyFindingId).toBe("finding-1");
    expect(pending.drafts["finding-1"]?.disposition ?? "none").toBe("none");
    expect(update(pending, Message.ClickedRequestChanges({ findingId: "finding-1" })).commands ?? []).toEqual([]);
    expect(update(pending, Message.ClickedFinish()).commands ?? []).toEqual([]);
    const failed = send(pending, Message.FailedAction({ findingId: "finding-1", message: "Connection failed" }));
    expect(failed.busyFindingId).toBeNull();
    expect(agentInstructions(failed)).toBe("No review feedback has been recorded yet.");
    const confirmedState = {
      ...reviewing(attached),
      findings: reviewing(attached).findings.map((finding) => ({ ...finding, status: "changes_requested" as const })),
    };
    const confirmed = send(
      pending,
      Message.CompletedAction({ findingId: "finding-1", state: confirmedState, message: "Saved" }),
    );
    expect(confirmed.drafts["finding-1"]?.disposition).toBe("request_changes");
    expect(deriveReview(reviewing(confirmed), confirmed).openCount).toBe(1);
  });
});
