import { relatedGroups } from "./shared/grouping/related";
import { currentCalibrationReport } from "./features/calibration/selectors";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { agentInstructions, detachedOutput } from "./features/decision/selectors";
import { findingContext } from "./features/detail/selectors";
import { decodeSavedReview } from "./features/session/command";
import { shortcutFor } from "./features/shortcuts/subscription";
import { Message } from "./message";
import { emptyDraft, persistedReview, Screen, type Model } from "./shared/model";
import { encodeJson } from "./shared/json";
import { deriveReview, effectiveFindingStatus } from "./shared/selectors";
import { update } from "./update";

const state = (mode: "calibration" | "review"): ReviewStatePayload => ({
  version: 3,
  sources: { "src/query.ts": "import { db } from './db';\n\nexport const users = () =>\n  db.user.findMany();\n" },
  coverage: { scope: "complete", files: ["src/query.ts"], rules: ["data/bounded-query"] },
  mode,
  transport: "detached",
  project: "demo",
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
      relatedFiles: ["src/query.ts"],
      invalidationReasons: [],
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
  selectionSettled: true,
  selectionVersion: 0,
  drafts: {},
  busyFindingId: null,
  finishing: false,
  refreshFailed: false,
  pendingExports: [],
  helpOpen: false,
  independentReview: false,
  independentNotes: {},
  revealedFindings: [],
  toastsPaused: false,
  modKey: "Ctrl",
  toasts: [],
  nextToastId: 1,
  persistFailed: false,
  saveVersion: 0,
});

const send = ({ current, message }: { readonly current: Model; readonly message: Message }): Model =>
  update({ model: current, message }).model;

const sendAll = (...[current, messages]: readonly [current: Model, messages: ReadonlyArray<Message>]): Model =>
  messages.reduce((nextModel, message) => send({ current: nextModel, message }), current);

const compareGroups = ({
  left,
  right,
}: {
  readonly left: readonly [string, string];
  readonly right: readonly [string, string];
}): number => left[0].localeCompare(right[0], "en-US");

const reviewing = (current: Model): ReviewStatePayload => {
  if (current.screen._tag !== "Reviewing") throw new Error("Expected the review screen.");
  return current.screen.state;
};

describe("review stories", () => {
  it("keeps calibration feedback temporary and copyable", () => {
    const selected = send({
      current: model("calibration"),
      message: Message.SelectedCalibration({ findingId: "finding-1", calibration: "does_not_apply" }),
    });
    expect(deriveReview({ state: reviewing(selected), model: selected }).queueCount).toBe(1);
    const saved = sendAll(selected, [
      Message.SelectedCalibrationReason({ findingId: "finding-1", reason: "scope" }),
      Message.ClickedSaveCalibration({ findingId: "finding-1" }),
    ]);
    expect(deriveReview({ state: reviewing(saved), model: saved }).queueCount).toBe(0);
    const current = sendAll(saved, [
      Message.UpdatedNote({ findingId: "finding-1", value: "Ignore generated clients." }),
      Message.ClickedSaveCalibration({ findingId: "finding-1" }),
    ]);
    expect(agentInstructions(current)).toContain("does_not_apply");
    expect(agentInstructions(current)).toContain("Ignore generated clients.");
    expect(detachedOutput({ model: current, acceptedAt: "2026-09-05T12:00:00.000Z" }).acceptanceOutput).toBe("");
  });

  it("exports full identity for a detached acceptance", () => {
    const accepted = sendAll(model("review"), [
      Message.UpdatedReason({ findingId: "finding-1", value: "The query is capped upstream." }),
      Message.ClickedAccept({ findingId: "finding-1" }),
    ]);
    const finding = reviewing(accepted).findings.find(({ id }) => id === "finding-1");
    if (finding === undefined) throw new Error("Expected the fixture finding.");
    expect(effectiveFindingStatus({ finding, state: reviewing(accepted), model: accepted })).toBe("accepted");
    const current = sendAll(accepted, [
      Message.ClickedFinish(),
      Message.PreparedDetachedFinish({ acceptedAt: "2026-08-10T18:00:00.000Z" }),
    ]);

    if (current.screen._tag !== "Finished") throw new Error("Expected the finished screen.");
    expect(current.screen.acceptanceOutput).toContain("binding-digest");
    expect(current.screen.acceptanceOutput).toContain("The query is capped upstream.");
    expect(current.screen.acceptanceOutput).toContain('"schemaVersion":1');
    expect(current.screen.acceptanceOutput).toContain('"type":"accept"');
    expect(current.screen.acceptanceOutput).toContain('"authority":"human"');
    expect(current.screen.acceptanceOutput).toContain('"reviewedSource":');
  });

  it("turns requested changes into an agent handoff", () => {
    const current = sendAll(model("review"), [
      Message.UpdatedReason({ findingId: "finding-1", value: "Add a hard limit of 100 rows." }),
      Message.ClickedRequestChanges({ findingId: "finding-1" }),
    ]);

    expect(agentInstructions(current)).toContain("Add a hard limit of 100 rows.");
  });

  it("debounces persistence while typing and writes only for the latest edit", () => {
    const first = update({
      model: model("review"),
      message: Message.UpdatedReason({ findingId: "finding-1", value: "Cap" }),
    });
    expect(first.model.drafts["finding-1"]?.reason).toBe("Cap");
    expect((first.commands ?? []).map(({ name }) => name)).toEqual(["DelayPersist"]);

    const second = update({
      model: first.model,
      message: Message.UpdatedReason({ findingId: "finding-1", value: "Capped" }),
    });
    expect(second.model.saveVersion).toBe(2);

    const stale = update({ model: second.model, message: Message.ElapsedPersistDelay({ version: 1 }) });
    expect(stale.commands ?? []).toHaveLength(0);

    const latest = update({ model: second.model, message: Message.ElapsedPersistDelay({ version: 2 }) });
    expect(latest.commands ?? []).toHaveLength(1);
    expect(latest.commands?.[0]?.name).toBe("PersistReview");
  });

  it("copies complete, paste-ready context for a finding", () => {
    const current = send({
      current: model("review"),
      message: Message.UpdatedReason({ findingId: "finding-1", value: "Add a hard limit of 100 rows." }),
    });
    const finding = reviewing(current).findings[0];
    if (finding === undefined) throw new Error("Expected a finding.");
    const content = findingContext({ finding, model: current });

    expect(content).toContain("# agentlint finding: Bound database queries");
    expect(content).toContain("Review this unbounded query.");
    expect(content).toContain("## Focused code context");
    expect(content).toContain("db.user.findMany()");
    expect(content).toContain("Add a hard limit of 100 rows.");
    expect(content).toContain('"bindingDigest": "binding-digest"');

    const copy = update({ model: current, message: Message.ClickedCopyFindingContext({ findingId: "finding-1" }) });
    expect((copy.commands ?? []).map(({ name }) => name)).toEqual(["CopyText"]);
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
          findings: reviewing(current).findings.map((finding) => Object.assign(finding, { editor: { canOpen: true } })),
        },
      }),
    };
    const selection = update({
      model: attached,
      message: Message.SelectedEditorApplication({ findingId: "finding-1", application: "vscode" }),
    });
    expect(selection.model.preferredApplication).toBe("vscode");
    expect((selection.commands ?? []).map(({ name }) => name)).toContain("OpenEditor");
    expect(selection.commands ?? []).toHaveLength(2);

    const open = update({ model: selection.model, message: Message.ClickedOpenFinding({ findingId: "finding-1" }) });
    expect((open.commands ?? []).map(({ name }) => name)).toEqual(["OpenEditor"]);
    expect(open.model.toasts).toEqual(selection.model.toasts);

    const unavailable = update({
      model: model("review"),
      message: Message.ClickedOpenFinding({ findingId: "finding-1" }),
    });
    expect((unavailable.commands ?? []).map(({ name }) => name)).not.toContain("OpenEditor");
    expect(unavailable.model.toasts.at(-1)?.message).toContain("Choose");
  });

  it("stacks at most five independently expiring toasts", () => {
    const current = sendAll(
      model("review"),
      ["First", "Second", "Third", "Fourth", "Fifth"].map((message) =>
        Message.CompletedUtility({ message, tone: "success" }),
      ),
    );
    const sixth = update({ model: current, message: Message.CompletedUtility({ message: "Sixth", tone: "neutral" }) });

    expect(sixth.model.toasts.map(({ message }) => message)).toEqual(["Second", "Third", "Fourth", "Fifth", "Sixth"]);
    expect(sixth.model.toasts.map(({ id }) => id)).toEqual([2, 3, 4, 5, 6]);
    expect(sixth.model.nextToastId).toBe(7);
    expect(sixth.commands ?? []).toHaveLength(1);
  });

  it("withdraws a staged decision so the reviewer can change their mind", () => {
    const requested = sendAll(model("review"), [
      Message.UpdatedReason({ findingId: "finding-1", value: "Cap it at 100." }),
      Message.ClickedRequestChanges({ findingId: "finding-1" }),
    ]);
    expect(requested.drafts["finding-1"]?.disposition).toBe("request_changes");
    const current = send({ current: requested, message: Message.ClickedWithdraw({ findingId: "finding-1" }) });
    expect(current.drafts["finding-1"]?.disposition).toBe("none");
    expect(current.drafts["finding-1"]?.reason).toBe("Cap it at 100.");
  });

  it("pauses toast expiry while the stack is hovered", () => {
    const current = sendAll(model("review"), [
      Message.CompletedUtility({ message: "Saved", tone: "success" }),
      Message.HoveredToasts(),
    ]);
    const paused = update({ model: current, message: Message.ExpiredToast({ id: 1 }) });
    expect(paused.model.toasts[0]?.phase).toBe("visible");
    expect(paused.commands ?? []).toHaveLength(1);
    const resumed = send({ current: paused.model, message: Message.LeftToasts() });
    expect(send({ current: resumed, message: Message.ExpiredToast({ id: 1 }) }).toasts[0]?.phase).toBe("leaving");
  });

  it("dismisses the newest toast with X", () => {
    const current = sendAll(model("review"), [
      Message.CompletedUtility({ message: "One", tone: "success" }),
      Message.CompletedUtility({ message: "Two", tone: "success" }),
    ]);
    const leaving = send({ current, message: Message.PressedShortcut({ action: "dismiss_toast" }) });
    expect(leaving.toasts.map(({ phase }) => phase)).toEqual(["visible", "leaving"]);
  });

  it("keeps danger toasts until manually dismissed", () => {
    const failed = update({
      model: model("review"),
      message: Message.CompletedUtility({ message: "Clipboard unavailable", tone: "danger" }),
    });
    expect(failed.commands ?? []).toHaveLength(0);
    expect(failed.model.toasts[0]).toMatchObject({ tone: "danger", phase: "visible" });

    const id = failed.model.toasts[0]?.id;
    if (id === undefined) throw new Error("Expected a toast.");
    const leaving = update({ model: failed.model, message: Message.ClickedDismissToast({ id }) });
    expect(leaving.model.toasts[0]?.phase).toBe("leaving");
    expect(leaving.commands ?? []).toHaveLength(1);

    const removed = send({ current: leaving.model, message: Message.RemovedToast({ id }) });
    expect(removed.toasts).toEqual([]);
  });

  it("expires the matching toast through its leaving phase", () => {
    const current = sendAll(model("review"), [
      Message.CompletedUtility({ message: "One", tone: "success" }),
      Message.CompletedUtility({ message: "Two", tone: "success" }),
    ]);

    const leaving = update({ model: current, message: Message.ExpiredToast({ id: 1 }) });
    expect(leaving.model.toasts.map(({ phase }) => phase)).toEqual(["leaving", "visible"]);
    expect(leaving.commands ?? []).toHaveLength(1);
    expect(
      send({ current: leaving.model, message: Message.RemovedToast({ id: 1 }) }).toasts.map(({ message }) => message),
    ).toEqual(["Two"]);
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
    const focus = update({ model: model("review"), message: Message.PressedShortcut({ action: "accept" }) });
    expect(focus.model.drafts["finding-1"]).toBeUndefined();
    expect(focus.commands ?? []).toHaveLength(1);

    const current = sendAll(model("review"), [
      Message.UpdatedReason({ findingId: "finding-1", value: "Capped upstream." }),
      Message.PressedShortcut({ action: "accept" }),
    ]);
    expect(current.drafts["finding-1"]?.disposition).toBe("accept");
  });

  it("toggles help and closes it with escape", () => {
    const opened = send({ current: model("review"), message: Message.PressedShortcut({ action: "help" }) });
    expect(opened.helpOpen).toBe(true);
    expect(send({ current: opened, message: Message.PressedShortcut({ action: "next" }) }).selectedFindingId).toBe(
      "finding-1",
    );
    expect(send({ current: opened, message: Message.PressedShortcut({ action: "escape" }) }).helpOpen).toBe(false);
  });

  it("keeps transient toast state out of persisted reviews", () => {
    const current = send({
      current: model("review"),
      message: Message.CompletedUtility({ message: "Saved", tone: "success" }),
    });
    const persisted = persistedReview(current);

    expect(current.toasts).toHaveLength(1);
    expect(persisted).not.toHaveProperty("toasts");
    expect(persisted).not.toHaveProperty("nextToastId");
  });

  it("derives the review once per model change and moves accepted findings to Decisions", () => {
    const current = model("review");
    const before = deriveReview({ state: reviewing(current), model: current });
    expect(deriveReview({ state: reviewing(current), model: current })).toBe(before);
    expect(before.queueCount).toBe(1);
    expect(before.openCount).toBe(1);
    expect(before.selected?.id).toBe("finding-1");
    expect(before.counts.rules.get("data/bounded-query")).toBe(1);

    const accepted = sendAll(current, [
      Message.UpdatedReason({ findingId: "finding-1", value: "Capped." }),
      Message.ClickedAccept({ findingId: "finding-1" }),
    ]);
    const after = deriveReview({ state: reviewing(accepted), model: accepted });
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
    const result = update({ model: start, message: Message.ClickedRequestChanges({ findingId: "finding-1" }) });
    if (result.model.screen._tag !== "Reviewing") throw new Error("Expected review");
    const derived = deriveReview({ state: result.model.screen.state, model: result.model });
    expect(derived.openCount).toBe(1);
    expect(derived.undecidedCount).toBe(0);
    const output = detachedOutput({ model: result.model, acceptedAt: "2026-09-05T13:00:00.000Z" });
    expect(
      Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({
            type: Schema.String,
            expectedReason: Schema.String,
            expectedAcceptedAt: Schema.String,
            reviewedSource: Schema.String,
          }),
        ),
      )(output.acceptanceOutput),
    ).toMatchObject({
      type: "revoke",
      expectedReason: "Previously examined",
      expectedAcceptedAt: "2026-09-05T12:00:00.000Z",
      reviewedSource: expect.stringContaining("findMany"),
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
    const pending = send({ current: attached, message: Message.ClickedRequestChanges({ findingId: "finding-1" }) });
    expect(pending.busyFindingId).toBe("finding-1");
    expect(pending.drafts["finding-1"]?.disposition ?? "none").toBe("none");
    expect(
      update({ model: pending, message: Message.ClickedRequestChanges({ findingId: "finding-1" }) }).commands ?? [],
    ).toEqual([]);
    expect(update({ model: pending, message: Message.ClickedFinish() }).commands ?? []).toEqual([]);
    const failed = send({
      current: pending,
      message: Message.FailedAction({ findingId: "finding-1", message: "Connection failed" }),
    });
    expect(failed.busyFindingId).toBeNull();
    expect(agentInstructions(failed)).toBe("No review feedback has been recorded yet.");
    const confirmedState = {
      ...reviewing(attached),
      findings: reviewing(attached).findings.map((finding) =>
        Object.assign(finding, { status: "changes_requested" as const }),
      ),
    };
    const confirmed = send({
      current: pending,
      message: Message.CompletedAction({ findingId: "finding-1", state: confirmedState, message: "Saved" }),
    });
    expect(confirmed.drafts["finding-1"]?.disposition).toBe("request_changes");
    expect(deriveReview({ state: reviewing(confirmed), model: confirmed }).openCount).toBe(1);
  });
});

describe("related review groups", () => {
  it("connects explicit shared dependencies transitively without merging decisions", () => {
    const original = state("review").findings[0];
    if (!original) throw new Error("Fixture missing");
    const findings = [
      { ...original, id: "a", file: "a.ts", relatedFiles: ["a.ts", "shared.ts"] },
      { ...original, id: "b", file: "b.ts", relatedFiles: ["b.ts", "shared.ts", "other.ts"] },
      { ...original, id: "c", file: "c.ts", relatedFiles: ["c.ts", "other.ts"] },
      { ...original, id: "d", file: "d.ts", relatedFiles: ["d.ts"] },
    ];
    const groups = relatedGroups(findings);
    expect(groups.get("a")).toBe(groups.get("c"));
    expect(groups.get("a")).not.toBe(groups.get("d"));
    expect([...relatedGroups(findings.toReversed())].toSorted((left, right) => compareGroups({ left, right }))).toEqual(
      [...groups].toSorted((left, right) => compareGroups({ left, right })),
    );
    const current = {
      ...model("review"),
      groupBy: "related" as const,
      screen: Screen.Reviewing({ state: { ...state("review"), findings } }),
    };
    const updated = send({
      current: send({ current, message: Message.UpdatedReason({ findingId: "a", value: "Verified" }) }),
      message: Message.ClickedAccept({ findingId: "a" }),
    });
    expect(deriveReview({ state: reviewing(updated), model: updated }).openCount).toBe(3);
  });
});

describe("independent review", () => {
  it("hides previous reasons in copied context, requires an assessment and preserves the gate", () => {
    const payload = state("review");
    const findings = payload.findings.map((finding) => ({
      ...finding,
      status: "accepted" as const,
      acceptance: {
        reason: "Prior secret rationale",
        actor: "reviewer",
        authority: "agent" as const,
        at: "2026-09-07",
      },
      lineageReason: "Older secret rationale",
      proposal: { summary: "Secret proposal", diff: null, actor: "agent", at: "2026-09-07" },
    }));
    const current = send({
      current: { ...model("review"), screen: Screen.Reviewing({ state: { ...payload, findings } }) },
      message: Message.ToggledIndependentReview(),
    });
    const finding = findings[0];
    if (!finding) throw new Error("Fixture missing");
    expect(findingContext({ finding, model: current })).not.toContain("secret rationale");
    expect(findingContext({ finding, model: current })).not.toContain("Secret proposal");
    expect(
      send({ current, message: Message.RevealedPriorDecision({ findingId: finding.id }) }).revealedFindings,
    ).toEqual([]);
    expect(
      update({ model: current, message: Message.ClickedRequestChanges({ findingId: finding.id }) }).commands ?? [],
    ).toEqual([]);
    expect(deriveReview({ state: reviewing(current), model: current }).openCount).toBe(0);
    const revealed = sendAll(current, [
      Message.UpdatedIndependentNote({ findingId: finding.id, value: "The query still lacks a bound." }),
      Message.RevealedPriorDecision({ findingId: finding.id }),
    ]);
    expect(findingContext({ finding, model: revealed })).toContain("Prior secret rationale");
    expect(revealed.drafts[finding.id]?.reason).toBe("The query still lacks a bound.");
    const requested = send({ current: revealed, message: Message.ClickedRequestChanges({ findingId: finding.id }) });
    expect(deriveReview({ state: reviewing(requested), model: requested }).openCount).toBe(1);
  });
});

describe("calibration report export", () => {
  it("counts saved labels only and keeps subsequent unsaved edits out of the report", () => {
    const selected = send({
      current: model("calibration"),
      message: Message.SelectedCalibration({ findingId: "finding-1", calibration: "does_not_apply" }),
    });
    expect(currentCalibrationReport({ state: reviewing(selected), model: selected }).observations).toEqual([]);
    const unsaved = send({ current: selected, message: Message.ClickedSaveCalibration({ findingId: "finding-1" }) });
    expect(currentCalibrationReport({ state: reviewing(unsaved), model: unsaved }).observations).toEqual([]);
    const current = sendAll(unsaved, [
      Message.SelectedCalibrationReason({ findingId: "finding-1", reason: "scope" }),
      Message.ClickedSaveCalibration({ findingId: "finding-1" }),
      Message.SelectedCalibration({ findingId: "finding-1", calibration: "applies" }),
    ]);
    expect(currentCalibrationReport({ state: reviewing(current), model: current }).observations[0]).toMatchObject({
      classification: "does_not_apply",
      reason: "scope",
    });
    expect(detachedOutput({ model: current, acceptedAt: "2026-09-07" }).acceptanceOutput).toBe("");
  });
});

/**
 * A queue of proposed findings: the effective reason is never empty, so `a` submits in one keystroke.
 */
const queue = ({
  transport,
  ids,
}: {
  readonly transport: "attached" | "detached";
  readonly ids: ReadonlyArray<string>;
}): Model => {
  const payload = state("review");
  const original = payload.findings[0];
  if (original === undefined) throw new Error("Fixture missing");
  return {
    ...model("review"),
    selectedFindingId: ids[1] ?? ids[0] ?? null,
    screen: Screen.Reviewing({
      state: {
        ...payload,
        transport,
        detached: transport === "detached" ? payload.detached : null,
        findings: ids.map((id, index) => ({
          ...original,
          id,
          line: index + 1,
          proposal: { summary: `Proposal for ${id}`, diff: null, actor: "agent", at: "2026-09-07" },
        })),
      },
    }),
  };
};

const commandNames = (result: ReturnType<typeof update>): ReadonlyArray<string> =>
  (result.commands ?? []).map(({ name }) => name);

type CommandArguments = NonNullable<ReturnType<typeof update>["commands"]>[number]["args"];

const commandArgs = ({
  result,
  name,
}: {
  readonly result: ReturnType<typeof update>;
  readonly name: string;
}): CommandArguments | undefined => (result.commands ?? []).find((command) => command.name === name)?.args;

describe("selection after a decision", () => {
  it("moves to the next finding and ignores a double-tapped accept until the selection settles", () => {
    const accepted = update({
      model: queue({ transport: "detached", ids: ["f1", "f2", "f3"] }),
      message: Message.PressedShortcut({ action: "accept" }),
    });
    expect(accepted.model.drafts["f2"]?.disposition).toBe("accept");
    expect(accepted.model.selectedFindingId).toBe("f3");
    expect(accepted.model.selectionSettled).toBe(false);
    expect(commandNames(accepted)).toContain("SettleSelection");
    expect(commandArgs({ result: accepted, name: "PersistReview" })).toMatchObject({ dirty: true });

    const doubleTap = send({ current: accepted.model, message: Message.PressedShortcut({ action: "accept" }) });
    expect(doubleTap.drafts["f1"]).toBeUndefined();
    expect(doubleTap.drafts["f3"]).toBeUndefined();
    expect(
      send({ current: accepted.model, message: Message.PressedShortcut({ action: "request_changes" }) }).drafts["f3"],
    ).toBeUndefined();

    const stale = send({
      current: accepted.model,
      message: Message.SettledSelection({ version: accepted.model.selectionVersion - 1 }),
    });
    expect(stale.selectionSettled).toBe(false);
    const settled = send({
      current: accepted.model,
      message: Message.SettledSelection({ version: accepted.model.selectionVersion }),
    });
    expect(
      send({ current: settled, message: Message.PressedShortcut({ action: "accept" }) }).drafts["f3"]?.disposition,
    ).toBe("accept");
  });

  it("falls back to the previous neighbour, then to nothing", () => {
    const first = send({
      current: { ...queue({ transport: "detached", ids: ["f1", "f2"] }), selectedFindingId: "f2" },
      message: Message.ClickedAccept({ findingId: "f2" }),
    });
    expect(first.selectedFindingId).toBe("f1");
    const current = send({ current: first, message: Message.ClickedAccept({ findingId: "f1" }) });
    expect(current.selectedFindingId).toBeNull();
    expect(current.selectionSettled).toBe(true);
  });

  it("lets navigation settle the selection at once", () => {
    const accepted = send({
      current: queue({ transport: "detached", ids: ["f1", "f2", "f3"] }),
      message: Message.PressedShortcut({ action: "accept" }),
    });
    const navigated = send({ current: accepted, message: Message.PressedShortcut({ action: "previous" }) });
    expect(navigated.selectedFindingId).toBe("f1");
    expect(navigated.selectionSettled).toBe(true);
    const late = send({
      current: navigated,
      message: Message.SettledSelection({ version: accepted.selectionVersion }),
    });
    expect(late).toBe(navigated);
  });

  it("never decides the first-row fallback of a selection that is not listed", () => {
    const current: Model = { ...queue({ transport: "detached", ids: ["f1", "f2"] }), selectedFindingId: "gone" };
    expect(deriveReview({ state: reviewing(current), model: current }).selected?.id).toBe("f1");
    const pressed = update({ model: current, message: Message.PressedShortcut({ action: "accept" }) });
    expect(pressed.model.drafts).toEqual({});
    expect(pressed.commands ?? []).toEqual([]);
  });

  it("advances after the server confirms an attached decision, also when it dropped the finding", () => {
    const pending = send({
      current: queue({ transport: "attached", ids: ["f1", "f2", "f3"] }),
      message: Message.PressedShortcut({ action: "accept" }),
    });
    expect(pending.busyFindingId).toBe("f2");
    expect(pending.selectedFindingId).toBe("f2");
    const remaining = reviewing(pending).findings.filter(({ id }) => id !== "f2");
    const confirmed = update({
      model: pending,
      message: Message.CompletedAction({
        findingId: "f2",
        state: { ...reviewing(pending), findings: remaining },
        message: "Saved",
      }),
    });
    expect(confirmed.model.busyFindingId).toBeNull();
    expect(confirmed.model.drafts["f2"]?.disposition).toBe("none");
    expect(confirmed.model.selectedFindingId).toBe("f3");
    expect(confirmed.model.selectionSettled).toBe(false);
    expect(commandNames(confirmed)).toContain("SettleSelection");
  });

  it("keeps the sort and the groups when only the selection moves", () => {
    const current = queue({ transport: "detached", ids: ["f1", "f2", "f3"] });
    const before = deriveReview({ state: reviewing(current), model: current });
    const moved = send({ current, message: Message.PressedShortcut({ action: "next" }) });
    const after = deriveReview({ state: reviewing(moved), model: moved });
    expect(after.selected?.id).toBe("f3");
    expect(after.visible).toBe(before.visible);
    expect(after.groups).toBe(before.groups);
  });
});

describe("loaded state", () => {
  const loaded = ({
    payload,
    saved,
  }: {
    readonly payload: ReviewStatePayload;
    readonly saved: ReturnType<typeof decodeSavedReview>;
  }) =>
    update({
      model: { ...model("review"), screen: Screen.Loading(), selectedFindingId: null },
      message: Message.LoadedState({ state: payload, saved: saved.saved, savedUnreadable: saved.unreadable }),
    });

  it("rejects a state that repeats a finding id", () => {
    const payload = state("review");
    const original = payload.findings[0];
    if (original === undefined) throw new Error("Fixture missing");
    const hostile = {
      ...payload,
      findings: [
        { ...original, id: "dup" },
        { ...original, id: "dup", file: "src/danger.ts", message: "Dangerous finding hidden behind the first." },
      ],
    };
    const result = loaded({ payload: hostile, saved: decodeSavedReview(null) });
    if (result.model.screen._tag !== "LoadFailed") throw new Error("Expected the load to fail.");
    expect(result.model.screen.message).toContain('"dup"');

    const attached: Model = { ...queue({ transport: "attached", ids: ["f1", "f2"] }), busyFindingId: "f1" };
    const refetched = send({
      current: attached,
      message: Message.CompletedAction({ findingId: "f1", state: hostile, message: "Saved" }),
    });
    expect(refetched.screen._tag).toBe("LoadFailed");
  });

  it("restores saved drafts, selects a listed finding and arms the leave prompt for detached decisions", () => {
    const decided = sendAll(model("review"), [
      Message.UpdatedReason({ findingId: "finding-1", value: "Capped upstream." }),
      Message.ClickedAccept({ findingId: "finding-1" }),
    ]);
    const blob = encodeJson(persistedReview(decided));

    const restored = loaded({ payload: state("review"), saved: decodeSavedReview(blob) });
    expect(restored.model.screen._tag).toBe("Reviewing");
    expect(restored.model.drafts["finding-1"]).toMatchObject({ disposition: "accept", reason: "Capped upstream." });
    expect(restored.model.toasts).toEqual([]);
    expect(commandArgs({ result: restored, name: "MarkDirty" })).toEqual({ dirty: true });

    const fresh = loaded({ payload: state("review"), saved: decodeSavedReview(null) });
    expect(fresh.model.selectedFindingId).toBe("finding-1");
    expect(fresh.model.selectionSettled).toBe(true);
    expect(commandArgs({ result: fresh, name: "MarkDirty" })).toEqual({ dirty: false });

    const attachedState = { ...state("review"), transport: "attached" as const, detached: null };
    expect(
      commandArgs({ result: loaded({ payload: attachedState, saved: decodeSavedReview(blob) }), name: "MarkDirty" }),
    ).toEqual({ dirty: false });
  });

  it("reports a corrupt or old-version saved review instead of dropping it silently", () => {
    expect(decodeSavedReview(null)).toEqual({ saved: null, unreadable: false });
    const old = encodeJson({ ...persistedReview(model("review")), version: 3 });
    for (const blob of ["{not json", old]) {
      const saved = decodeSavedReview(blob);
      expect(saved).toEqual({ saved: null, unreadable: true });
      const result = loaded({ payload: state("review"), saved });
      expect(result.model.screen._tag).toBe("Reviewing");
      expect(result.model.toasts.at(-1)).toMatchObject({ tone: "danger" });
      expect(result.model.toasts.at(-1)?.message).toContain(":bak");
    }
  });
});

describe("attached refresh failure", () => {
  it("reports a recorded decision as saved, releases the busy state and offers a reload", () => {
    const pending = send({
      current: queue({ transport: "attached", ids: ["f1", "f2"] }),
      message: Message.ClickedAccept({ findingId: "f2" }),
    });
    const result = update({
      model: pending,
      message: Message.RecordedActionRefreshFailed({ findingId: "f2", message: "Review request failed: offline" }),
    });
    expect(result.model.busyFindingId).toBeNull();
    expect(result.model.refreshFailed).toBe(true);
    expect(result.model.toasts.at(-1)).toMatchObject({
      tone: "neutral",
      message: "Decision saved; reload to refresh.",
    });

    expect(commandNames(update({ model: result.model, message: Message.ClickedReloadReview() }))).toEqual([
      "LoadReview",
    ]);
    const stillDown = send({ current: result.model, message: Message.FailedLoadState({ message: "offline" }) });
    expect(stillDown.screen._tag).toBe("Reviewing");
    expect(stillDown.toasts.at(-1)).toMatchObject({ tone: "danger" });

    const reloaded = send({
      current: stillDown,
      message: Message.LoadedState({ state: reviewing(pending), saved: null, savedUnreadable: false }),
    });
    expect(reloaded.refreshFailed).toBe(false);
  });

  it("keeps a stale local disposition out of the handoff and the copied context", () => {
    const current: Model = {
      ...queue({ transport: "attached", ids: ["f1"] }),
      drafts: { f1: { ...emptyDraft(), disposition: "request_changes", reason: "Stale request." } },
    };
    const finding = reviewing(current).findings[0];
    if (finding === undefined) throw new Error("Fixture missing");
    expect(agentInstructions(current)).toBe("No review feedback has been recorded yet.");
    expect(findingContext({ finding, model: current })).toContain("- Status: unresolved");
    expect(findingContext({ finding, model: current })).not.toContain("Disposition:");
  });
});

describe("local persistence failure", () => {
  it("tells the reviewer once, and again only after a write succeeded in between", () => {
    const first = send({
      current: model("review"),
      message: Message.FailedPersistence({ message: "QuotaExceededError" }),
    });
    expect(first.toasts).toHaveLength(1);
    expect(first.toasts[0]).toMatchObject({ tone: "danger" });
    expect(first.toasts[0]?.message).toContain("QuotaExceededError");
    expect(
      send({ current: first, message: Message.FailedPersistence({ message: "QuotaExceededError" }) }).toasts,
    ).toHaveLength(1);
    const recovered = send({ current: first, message: Message.CompletedPersistence() });
    expect(
      send({ current: recovered, message: Message.FailedPersistence({ message: "QuotaExceededError" }) }).toasts,
    ).toHaveLength(2);
  });

  it("never evicts an undismissed danger toast", () => {
    const current = sendAll(model("review"), [
      Message.CompletedUtility({ message: "Save failed", tone: "danger" }),
      ...["One", "Two", "Three", "Four", "Five", "Six"].map((message) =>
        Message.CompletedUtility({ message, tone: "success" }),
      ),
    ]);
    expect(current.toasts.map(({ message }) => message)).toEqual(["Save failed", "Three", "Four", "Five", "Six"]);
  });
});

describe("request changes from the keyboard", () => {
  it("focuses the reason instead of recording an empty request", () => {
    const pressed = update({ model: model("review"), message: Message.PressedShortcut({ action: "request_changes" }) });
    expect(pressed.model.drafts["finding-1"]).toBeUndefined();
    expect(commandArgs({ result: pressed, name: "FocusElement" })).toEqual({ selector: ".decision textarea" });

    const withReason = send({
      current: model("review"),
      message: Message.UpdatedReason({ findingId: "finding-1", value: "Cap it." }),
    });
    expect(
      send({ current: withReason, message: Message.PressedShortcut({ action: "request_changes" }) }).drafts["finding-1"]
        ?.disposition,
    ).toBe("request_changes");
  });

  it("never hands the detector's message to the agent as the reviewer's instruction", () => {
    const requested = send({
      current: model("review"),
      message: Message.ClickedRequestChanges({ findingId: "finding-1" }),
    });
    const handoff = agentInstructions(requested);
    expect(handoff).not.toContain("src/query.ts:4: Review this unbounded query.");
    expect(handoff).toContain("the reviewer left no instruction");
    expect(handoff).toContain("The detector reported: Review this unbounded query.");
  });
});

describe("finishing", () => {
  it("sends one finish request for a double click and allows a retry after a failure", () => {
    const attached = queue({ transport: "attached", ids: ["f1"] });
    const first = update({ model: attached, message: Message.ClickedFinish() });
    expect(commandNames(first)).toEqual(["FinishReview"]);
    expect(update({ model: first.model, message: Message.ClickedFinish() }).commands ?? []).toEqual([]);
    const failed = send({ current: first.model, message: Message.FailedFinish({ message: "offline" }) });
    expect(commandNames(update({ model: failed, message: Message.ClickedFinish() }))).toEqual(["FinishReview"]);
  });

  it("keeps the leave prompt armed until every detached output was exported", () => {
    const current = sendAll(model("review"), [
      Message.UpdatedReason({ findingId: "finding-1", value: "Capped upstream." }),
      Message.ClickedAccept({ findingId: "finding-1" }),
    ]);
    const prepared = update({
      model: current,
      message: Message.PreparedDetachedFinish({ acceptedAt: "2026-08-10T18:00:00.000Z" }),
    });
    expect(prepared.model.pendingExports).toEqual(["acceptances"]);
    expect(commandArgs({ result: prepared, name: "MarkDirty" })).toEqual({ dirty: true });
    expect(commandArgs({ result: prepared, name: "FocusElement" })).toEqual({ selector: ".finish h1" });

    const download = update({ model: prepared.model, message: Message.ClickedDownloadAcceptances() });
    expect(commandArgs({ result: download, name: "DownloadText" })).toMatchObject({ kind: "acceptances" });
    const exported = update({
      model: prepared.model,
      message: Message.ExportedOutput({ kind: "acceptances", message: "Downloaded." }),
    });
    expect(exported.model.pendingExports).toEqual([]);
    expect(commandArgs({ result: exported, name: "MarkDirty" })).toEqual({ dirty: false });
  });

  it("never arms the leave prompt for an attached review", () => {
    const attached: Model = {
      ...queue({ transport: "attached", ids: ["f1"] }),
      drafts: { f1: { ...emptyDraft(), disposition: "accept" } },
    };
    const persisted = update({ model: attached, message: Message.SelectedFinding({ findingId: "f1" }) });
    expect(commandArgs({ result: persisted, name: "PersistReview" })).toMatchObject({ dirty: false });
  });
});

describe("help dialog", () => {
  it("closes idempotently and returns focus to its trigger", () => {
    const opened = send({ current: model("review"), message: Message.ToggledHelp() });
    const closed = update({ model: opened, message: Message.ClosedHelp() });
    expect(closed.model.helpOpen).toBe(false);
    expect(commandArgs({ result: closed, name: "FocusElement" })).toEqual({ selector: "#help-trigger" });
    const again = update({ model: closed.model, message: Message.ClosedHelp() });
    expect(again.model.helpOpen).toBe(false);
    expect(again.commands ?? []).toEqual([]);
  });
});
