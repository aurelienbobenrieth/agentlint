import { Match as M } from "effect";
import { Command } from "foldkit";
import { evo } from "foldkit/struct";

import {
  BlurActive,
  CopyText,
  DownloadText,
  ExpireToast,
  FinishReview,
  FocusElement,
  OpenEditor,
  PersistReview,
  PrepareDetachedFinish,
  RemoveToast,
  RevealSelectedRow,
  reviewStorageKey,
  SubmitAction,
  TogglePopover,
} from "./command";
import {
  ClickedCopyFindingContext,
  ClickedOpenFinding,
  PressedShortcut,
  SelectedView,
  ToggledGuidance,
  ToggledSidebar,
  type Message,
} from "./message";
import {
  clampSidebarWidth,
  type Draft,
  emptyDraft,
  emptyFacets,
  Finished,
  type Model,
  persistedReview,
  Reviewing,
  type ToastTone,
} from "./model";
import { selectedFinding } from "./selection";
import type { ReviewActionRequest, ReviewFindingPayload } from "./types";

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];

const toastDuration = (tone: ToastTone): number => (tone === "success" ? 4_000 : 6_000);

const enqueueToast = (model: Model, message: string, tone: ToastTone = "neutral"): UpdateReturn => {
  const id = model.nextToastId;
  const next = evo(model, {
    toasts: (toasts) => [...toasts, { id, message, tone, phase: "visible" as const }].slice(-5),
    nextToastId: (value) => value + 1,
  });
  return [next, tone === "danger" ? [] : [ExpireToast({ id, delayMs: toastDuration(tone) })]];
};

const dismissToast = (model: Model, id: number): UpdateReturn => {
  const toast = model.toasts.find((candidate) => candidate.id === id);
  if (toast === undefined || toast.phase === "leaving") return [model, []];
  return [
    evo(model, {
      toasts: (toasts) =>
        toasts.map((candidate) => (candidate.id === id ? { ...candidate, phase: "leaving" as const } : candidate)),
    }),
    [RemoveToast({ id })],
  ];
};

const appendCommands = (result: UpdateReturn, commands: ReadonlyArray<Command.Command<Message>>): UpdateReturn => [
  result[0],
  [...result[1], ...commands],
];

const persist = (model: Model): UpdateReturn => {
  if (model.screen._tag !== "Reviewing") return [model, []];
  const saving = evo(model, { saveState: () => "saving" as const });
  return [
    saving,
    [
      PersistReview({
        key: reviewStorageKey(model.screen.state),
        content: JSON.stringify(persistedReview(saving)),
      }),
    ],
  ];
};

const persistChange = (model: Model, change: (model: Model) => Model): UpdateReturn => persist(change(model));

const toggle = <T>(values: ReadonlyArray<T>, value: T): ReadonlyArray<T> =>
  values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];

const draftFor = (model: Model, findingId: string) => model.drafts[findingId] ?? emptyDraft();

const updateDraft = (
  model: Model,
  findingId: string,
  change: (draft: ReturnType<typeof emptyDraft>) => ReturnType<typeof emptyDraft>,
): Model =>
  evo(model, {
    drafts: (drafts) => ({ ...drafts, [findingId]: change(draftFor(model, findingId)) }),
  });

/** Accepting an agent proposal without a note records the proposal itself as the reason. */
const effectiveReason = (model: Model, finding: ReviewFindingPayload): string => {
  const reason = draftFor(model, finding.id).reason.trim();
  if (reason.length > 0) return reason;
  return finding.proposal === null ? "" : `Accepted the agent proposal: ${finding.proposal.summary}`;
};

const requestFor = (
  model: Model,
  kind: "accept" | "request_changes" | "withdraw" | "calibrate",
  findingId: string,
  finding: ReviewFindingPayload | undefined,
) => {
  const draft = draftFor(model, findingId);
  if (kind === "withdraw") return { type: "withdraw", findingId } satisfies ReviewActionRequest;
  if (kind === "calibrate") {
    return {
      type: "calibrate",
      findingId,
      calibration: draft.calibration === "unreviewed" ? "unsure" : draft.calibration,
      note: draft.note,
    } satisfies ReviewActionRequest;
  }
  return {
    type: kind,
    findingId,
    reason: kind === "accept" && finding !== undefined ? effectiveReason(model, finding) : draft.reason,
  } satisfies ReviewActionRequest;
};

const findingInstruction = (finding: ReviewFindingPayload, model: Model): string => {
  const draft = draftFor(model, finding.id);
  if (model.screen._tag === "Reviewing" && model.screen.state.mode === "calibration") {
    return `- ${finding.ruleId} at ${finding.file}:${finding.line}: ${draft.calibration}. ${draft.note}`;
  }
  return `- ${finding.ruleId} at ${finding.file}:${finding.line}: ${draft.reason || finding.message}`;
};

const fenced = (content: string, language = ""): string => {
  const fence = content.includes("```") ? "````" : "```";
  return `${fence}${language}\n${content}\n${fence}`;
};

const focusedSource = (finding: ReviewFindingPayload): string => {
  const lines = finding.code.source.split("\n");
  const start = Math.max(0, finding.code.focus.startLine - 4);
  const end = Math.min(lines.length, finding.code.focus.endLine + 3);
  return lines
    .slice(start, end)
    .map((line, index) => `${String(start + index + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
};

/** Complete, paste-ready evidence for discussing one finding with another agent. */
export const findingContext = (finding: ReviewFindingPayload, model: Model): string => {
  const draft = draftFor(model, finding.id);
  const status =
    draft.disposition === "accept"
      ? "accepted"
      : draft.disposition === "request_changes"
        ? "changes_requested"
        : finding.status;
  const language = finding.file.match(/\.tsx?$/u) ? "typescript" : finding.file.match(/\.jsx?$/u) ? "javascript" : "";
  const reviewInput = [
    draft.disposition !== "none" ? `Disposition: ${draft.disposition}` : null,
    draft.reason.trim().length > 0 ? `Reason or requested change: ${draft.reason.trim()}` : null,
    draft.calibration !== "unreviewed" ? `Calibration: ${draft.calibration}` : null,
    draft.note.trim().length > 0 ? `Calibration note: ${draft.note.trim()}` : null,
  ].filter((line): line is string => line !== null);
  const acceptance =
    finding.acceptance === null
      ? "None."
      : `${finding.acceptance.reason} (by ${finding.acceptance.actor}, ${finding.acceptance.at})`;
  const references =
    finding.guidance.references.length === 0
      ? "None."
      : finding.guidance.references
          .map((reference) => `- ${reference.label} (${reference.kind}): ${reference.target}`)
          .join("\n");
  const examples =
    finding.guidance.examples.length === 0
      ? "None provided."
      : finding.guidance.examples
          .map((example) =>
            [
              example.label === null ? null : `### ${example.label}`,
              example.description,
              fenced(example.code, language),
            ]
              .filter((part): part is string => part !== null)
              .join("\n\n"),
          )
          .join("\n\n");
  const identity = {
    ruleId: finding.ruleId,
    source: finding.identity.source,
    fingerprint: finding.identity.fingerprint,
    lineageKey: finding.identity.lineageKey,
  };

  return [
    `# agentlint finding: ${finding.ruleTitle}`,
    "",
    `- Rule: \`${finding.ruleId}\``,
    `- Location: \`${finding.file}:${finding.line}:${finding.column}\``,
    `- Lifecycle: ${finding.lifecycle}`,
    `- Review authority: ${finding.authority}`,
    `- Status: ${status}`,
    "",
    "## Why this was flagged",
    "",
    finding.message,
    "",
    "## Rule standard",
    "",
    ...(finding.guidance.summary === null ? [] : [finding.guidance.summary, ""]),
    finding.guidance.standard,
    ...(finding.guidance.checks.length > 0
      ? ["", "### Review checklist", "", ...finding.guidance.checks.map((check) => `- ${check}`)]
      : []),
    "",
    "## Focused code context",
    "",
    fenced(focusedSource(finding), language),
    "",
    "## Complete file",
    "",
    fenced(finding.code.source, language),
    "",
    "## Permitted examples",
    "",
    examples,
    "",
    "## References",
    "",
    references,
    "",
    "## Current review evidence",
    "",
    `Acceptance: ${acceptance}`,
    `Prior lineage reasoning: ${finding.lineageReason ?? "None."}`,
    ...(reviewInput.length > 0 ? ["", ...reviewInput] : []),
    "",
    "## Stable identity",
    "",
    fenced(JSON.stringify(identity, null, 2), "json"),
  ].join("\n");
};

export const agentInstructions = (model: Model): string => {
  if (model.screen._tag === "Finished") {
    return model.screen.feedback.length > 0 ? model.screen.feedback : "No changes were requested.";
  }
  if (model.screen._tag !== "Reviewing") return "No open review instructions.";
  const lines = model.screen.state.findings
    .filter((finding) => {
      const draft = draftFor(model, finding.id);
      return draft.disposition === "request_changes" || draft.note.length > 0 || draft.calibration !== "unreviewed";
    })
    .map((finding) => findingInstruction(finding, model));
  return lines.length === 0
    ? "No review feedback has been recorded yet."
    : ["Apply this agentlint review feedback:", "", ...lines].join("\n");
};

const detachedOutput = (model: Model, acceptedAt: string) => {
  if (model.screen._tag !== "Reviewing") {
    return { summary: "Review complete.", feedback: "", acceptanceOutput: "" };
  }
  const hasFeedback = model.screen.state.findings.some((finding) => {
    const draft = draftFor(model, finding.id);
    return draft.disposition === "request_changes" || draft.note.length > 0 || draft.calibration !== "unreviewed";
  });
  const feedback = hasFeedback ? agentInstructions(model) : "";
  const acceptances = model.screen.state.findings.flatMap((finding) => {
    const draft = draftFor(model, finding.id);
    return draft.disposition === "accept" && model.screen._tag === "Reviewing" && model.screen.state.mode === "review"
      ? [
          {
            schemaVersion: 1,
            source: finding.identity.source,
            fingerprint: finding.identity.fingerprint,
            ...(finding.identity.lineageKey === null ? {} : { lineageKey: finding.identity.lineageKey }),
            reason: effectiveReason(model, finding),
            authority: "human",
            actor: "local-review",
            acceptedAt,
          },
        ]
      : [];
  });
  const acceptanceOutput =
    acceptances.length > 0 ? `${acceptances.map((acceptance) => JSON.stringify(acceptance)).join("\n")}\n` : "";
  const summary =
    model.screen.state.mode === "calibration"
      ? "Calibration feedback is ready for the rule author."
      : acceptances.length > 0 && feedback.length > 0
        ? `Prepared ${acceptances.length} acceptance output(s) and an agent handoff.`
        : acceptances.length > 0
          ? `Prepared ${acceptances.length} acceptance output(s).`
          : feedback.length > 0
            ? "Requested changes are ready for the coding agent."
            : "The review closed without exported decisions.";
  return {
    summary,
    feedback,
    acceptanceOutput,
  };
};

const dispositionFor = (
  kind: "accept" | "request_changes" | "withdraw" | "calibrate",
  current: Draft["disposition"],
) =>
  kind === "accept"
    ? "accept"
    : kind === "request_changes"
      ? "request_changes"
      : kind === "withdraw"
        ? "none"
        : current;

const submit = (
  model: Model,
  kind: "accept" | "request_changes" | "withdraw" | "calibrate",
  findingId: string,
): UpdateReturn => {
  if (model.screen._tag !== "Reviewing") return [model, []];
  const finding = model.screen.state.findings.find(({ id }) => id === findingId);
  const request = requestFor(model, kind, findingId, finding);
  if (model.screen.state.transport === "detached") {
    const [notified, toastCommands] = enqueueToast(
      model,
      kind === "withdraw" ? "Decision withdrawn." : "Decision saved in this browser.",
      "success",
    );
    return appendCommands(
      persist(
        updateDraft(notified, findingId, (draft) => ({
          ...draft,
          disposition: dispositionFor(kind, draft.disposition),
        })),
      ),
      toastCommands,
    );
  }
  const optimistic = updateDraft(model, findingId, (draft) => ({
    ...draft,
    disposition: dispositionFor(kind, draft.disposition),
  }));
  const [saving, persistence] = persist(optimistic);
  return [
    evo(saving, { busyFindingId: () => findingId }),
    [...persistence, SubmitAction({ findingId, requestJson: JSON.stringify(request) })],
  ];
};

/** Only the selected finding renders a decision form, so the selector is unambiguous. */
const reasonSelector = (): string => ".decision textarea";

/** Keyboard shortcuts resolve against what the reviewer currently sees. */
const pressedShortcut = (model: Model, action: (typeof PressedShortcut.Type)["action"]): UpdateReturn => {
  if (action === "escape") {
    return [evo(model, { helpOpen: () => false }), [BlurActive()]];
  }
  if (action === "help") return [evo(model, { helpOpen: (open) => !open }), []];
  if (model.screen._tag !== "Reviewing" || model.helpOpen) return [model, []];
  const state = model.screen.state;
  const { visible, selected } = selectedFinding(state, model);
  const index = selected === undefined ? -1 : visible.findIndex(({ id }) => id === selected.id);
  const select = (finding: ReviewFindingPayload | undefined): UpdateReturn =>
    finding === undefined
      ? [model, []]
      : appendCommands(
          persistChange(model, (current) => evo(current, { selectedFindingId: () => finding.id })),
          [RevealSelectedRow()],
        );
  const decide = (kind: "accept" | "request_changes"): UpdateReturn => {
    if (selected === undefined || state.mode === "calibration") return [model, []];
    if (kind === "accept" && effectiveReason(model, selected).length === 0) {
      return [model, [FocusElement({ selector: reasonSelector() })]];
    }
    return submit(model, kind, selected.id);
  };
  switch (action) {
    case "next":
      return select(visible[index + 1] ?? visible[0]);
    case "previous":
      return select(index > 0 ? visible[index - 1] : visible.at(-1));
    case "accept":
      return decide("accept");
    case "request_changes":
      return decide("request_changes");
    case "open":
      return selected === undefined ? [model, []] : update(model, ClickedOpenFinding({ findingId: selected.id }));
    case "copy":
      return selected === undefined
        ? [model, []]
        : update(model, ClickedCopyFindingContext({ findingId: selected.id }));
    case "search":
      return [model, [FocusElement({ selector: ".search__input" })]];
    case "filters":
      return [model, [TogglePopover({ id: "filter-menu" })]];
    case "queue":
      return update(model, SelectedView({ view: "queue" }));
    case "decisions":
      return update(model, SelectedView({ view: "decisions" }));
    case "sidebar":
      return update(model, ToggledSidebar());
    case "guidance":
      return update(model, ToggledGuidance());
    case "dismiss_toast": {
      const latest = model.toasts.findLast((toast) => toast.phase === "visible");
      return latest === undefined ? [model, []] : dismissToast(model, latest.id);
    }
  }
};

export const update = (model: Model, event: Message): UpdateReturn =>
  M.value(event).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      LoadedState: ({ state, saved }) => {
        const restored = evo(model, {
          screen: () => Reviewing({ state }),
          view: () => saved?.view ?? model.view,
          facets: () => saved?.facets ?? model.facets,
          groupBy: () => saved?.groupBy ?? model.groupBy,
          codeView: () => saved?.codeView ?? model.codeView,
          guidanceOpen: () => saved?.guidanceOpen ?? model.guidanceOpen,
          sidebarOpen: () => saved?.sidebarOpen ?? model.sidebarOpen,
          sidebarWidth: () => saved?.sidebarWidth ?? model.sidebarWidth,
          preferredApplication: () => saved?.preferredApplication ?? model.preferredApplication,
          query: () => saved?.query ?? model.query,
          selectedFindingId: () => saved?.selectedFindingId ?? null,
          drafts: () => saved?.drafts ?? model.drafts,
          toasts: () => [],
          saveState: () => (saved === null ? ("idle" as const) : ("saved" as const)),
        });
        Reflect.set(window, "__AGENTLINT_REVIEW_DIRTY__", state.findings.length > 0);
        return [restored, []];
      },
      FailedLoadState: ({ message }) => [evo(model, { screen: () => ({ _tag: "LoadFailed", message }) }), []],
      SelectedView: ({ view }) =>
        persistChange(model, (current) => evo(current, { view: () => view, selectedFindingId: () => null })),
      ToggledStatusFacet: ({ status }) =>
        persistChange(model, (current) =>
          evo(current, { facets: (facets) => ({ ...facets, statuses: toggle(facets.statuses, status) }) }),
        ),
      ToggledAuthorityFacet: ({ authority }) =>
        persistChange(model, (current) =>
          evo(current, { facets: (facets) => ({ ...facets, authorities: toggle(facets.authorities, authority) }) }),
        ),
      ToggledLifecycleFacet: ({ lifecycle }) =>
        persistChange(model, (current) =>
          evo(current, { facets: (facets) => ({ ...facets, lifecycles: toggle(facets.lifecycles, lifecycle) }) }),
        ),
      ToggledRuleFacet: ({ ruleId }) =>
        persistChange(model, (current) =>
          evo(current, { facets: (facets) => ({ ...facets, ruleIds: toggle(facets.ruleIds, ruleId) }) }),
        ),
      ClearedFacets: () => persistChange(model, (current) => evo(current, { facets: () => emptyFacets() })),
      SelectedGroupBy: ({ groupBy }) => persistChange(model, (current) => evo(current, { groupBy: () => groupBy })),
      SelectedCodeView: ({ codeView }) => persistChange(model, (current) => evo(current, { codeView: () => codeView })),
      ToggledGuidance: () => persistChange(model, (current) => evo(current, { guidanceOpen: (open) => !open })),
      SetGuidanceOpen: ({ open }) =>
        open === model.guidanceOpen
          ? [model, []]
          : persistChange(model, (current) => evo(current, { guidanceOpen: () => open })),
      StartedSidebarResize: () => [evo(model, { resizingSidebar: () => true }), []],
      ResizedSidebar: ({ width }) => [evo(model, { sidebarWidth: () => clampSidebarWidth(width) }), []],
      EndedSidebarResize: () => persistChange(model, (current) => evo(current, { resizingSidebar: () => false })),
      ToggledHelp: () => [evo(model, { helpOpen: (open) => !open }), []],
      PressedShortcut: ({ action }) => pressedShortcut(model, action),
      UpdatedQuery: ({ value }) => persistChange(model, (current) => evo(current, { query: () => value })),
      ToggledSidebar: () => persistChange(model, (current) => evo(current, { sidebarOpen: (value) => !value })),
      PreparedDecision: ({ findingId, intent }) => {
        const changed = persistChange(model, (current) =>
          evo(current, {
            selectedFindingId: () => findingId,
          }),
        );
        const toasted = enqueueToast(
          changed[0],
          intent === "accept" ? "Add the evidence, then accept." : "Describe the change for the coding agent.",
        );
        return appendCommands(toasted, changed[1]);
      },
      SelectedFinding: ({ findingId }) =>
        persistChange(model, (current) => evo(current, { selectedFindingId: () => findingId })),
      UpdatedReason: ({ findingId, value }) =>
        persistChange(model, (current) => updateDraft(current, findingId, (draft) => ({ ...draft, reason: value }))),
      UpdatedNote: ({ findingId, value }) =>
        persistChange(model, (current) => updateDraft(current, findingId, (draft) => ({ ...draft, note: value }))),
      SelectedCalibration: ({ findingId, calibration }) =>
        persistChange(model, (current) => updateDraft(current, findingId, (draft) => ({ ...draft, calibration }))),
      ClickedAccept: ({ findingId }) => submit(model, "accept", findingId),
      ClickedRequestChanges: ({ findingId }) => submit(model, "request_changes", findingId),
      ClickedWithdraw: ({ findingId }) => submit(model, "withdraw", findingId),
      HoveredToasts: () => [evo(model, { toastsPaused: () => true }), []],
      LeftToasts: () => [evo(model, { toastsPaused: () => false }), []],
      ClickedSaveCalibration: ({ findingId }) => submit(model, "calibrate", findingId),
      CompletedAction: ({ state, message }) =>
        enqueueToast(evo(model, { screen: () => Reviewing({ state }), busyFindingId: () => null }), message, "success"),
      FailedAction: ({ message }) => enqueueToast(evo(model, { busyFindingId: () => null }), message, "danger"),
      CompletedPersistence: () => [evo(model, { saveState: () => "saved" as const }), []],
      FailedPersistence: ({ message }) =>
        enqueueToast(evo(model, { saveState: () => "failed" as const }), `Local save failed: ${message}`, "danger"),
      ClickedCheckpoint: () => {
        const [saving, commands] = persist(model);
        return appendCommands(
          enqueueToast(saving, "Checkpoint saved. You can safely return to this review.", "success"),
          commands,
        );
      },
      ClickedFinish: () => {
        if (model.screen._tag !== "Reviewing") return [model, []];
        if (model.screen.state.transport === "detached") {
          return [model, [PrepareDetachedFinish()]];
        }
        return [model, [FinishReview()]];
      },
      PreparedDetachedFinish: ({ acceptedAt }) => {
        const output = detachedOutput(model, acceptedAt);
        return [evo(model, { screen: () => Finished(output), toasts: () => [] }), []];
      },
      CompletedFinish: ({ summary, feedback, acceptanceOutput }) => [
        evo(model, {
          screen: () => Finished({ summary, feedback, acceptanceOutput }),
          toasts: () => [],
        }),
        [],
      ],
      FailedFinish: ({ message }) => enqueueToast(model, message, "danger"),
      ClickedCopyInstructions: () => [model, [CopyText({ content: agentInstructions(model) })]],
      ClickedCopyFindingContext: ({ findingId }) => {
        if (model.screen._tag !== "Reviewing") return [model, []];
        const finding = model.screen.state.findings.find(({ id }) => id === findingId);
        return finding === undefined
          ? enqueueToast(model, "The finding is no longer available.", "danger")
          : [
              model,
              [
                CopyText({
                  content: findingContext(finding, model),
                  successMessage: "Finding context copied.",
                }),
              ],
            ];
      },
      ClickedOpenFinding: ({ findingId }) => {
        if (model.screen._tag !== "Reviewing") return [model, []];
        const finding = model.screen.state.findings.find(({ id }) => id === findingId);
        const application = model.screen.state.applications.find(({ id }) => id === model.preferredApplication);
        return finding?.editor !== null && application !== undefined
          ? [model, [OpenEditor({ findingId, application: application.id })]]
          : enqueueToast(model, "Choose an available application before opening this finding.", "neutral");
      },
      SelectedEditorApplication: ({ findingId, application }) => {
        if (model.screen._tag !== "Reviewing") return [model, []];
        const finding = model.screen.state.findings.find(({ id }) => id === findingId);
        const available = model.screen.state.applications.some(({ id }) => id === application);
        if (finding?.editor === null || !available) {
          return enqueueToast(model, "That application is not available for this review.", "danger");
        }
        return appendCommands(
          persistChange(model, (current) => evo(current, { preferredApplication: () => application })),
          [OpenEditor({ findingId, application })],
        );
      },
      ClickedDownloadAcceptances: () => {
        const content = model.screen._tag === "Finished" ? model.screen.acceptanceOutput : "";
        return [model, [DownloadText({ content, filename: "agentlint-acceptances.jsonl" })]];
      },
      CompletedUtility: ({ message, tone }) => enqueueToast(model, message, tone),
      ClickedDismissToast: ({ id }) => dismissToast(model, id),
      ExpiredToast: ({ id }) =>
        model.toastsPaused && model.toasts.some((toast) => toast.id === id)
          ? [model, [ExpireToast({ id, delayMs: 1_500 })]]
          : dismissToast(model, id),
      RemovedToast: ({ id }) => [evo(model, { toasts: (toasts) => toasts.filter((toast) => toast.id !== id) }), []],
      PerformedDomEffect: () => [model, []],
    }),
  );
