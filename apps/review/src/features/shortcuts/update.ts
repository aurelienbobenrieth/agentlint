import { evo } from "foldkit/struct";

import type { ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Model, Shortcut } from "../../shared/model";
import { deriveReview, draftFor } from "../../shared/selectors";
import { appendCommands, type Handlers, type UpdateReturn } from "../../shared/update";
import { effectiveReason } from "../decision/selectors";
import { submit } from "../decision/update";
import { selectFinding } from "../list/selection";
import { persistChange } from "../session/update";
import { dismissToast } from "../toasts/update";
import { BlurActive, FocusElement, RevealSelectedRow, ShowHelp, TogglePopover } from "./command";
import type { fields } from "./messages";

type Update = (input: { readonly model: Model; readonly message: Message }) => UpdateReturn;

const DETAIL_HEADING = ".detail__head h1";
const HELP_TRIGGER = "#help-trigger";

/**
 * Keyboard shortcuts resolve against what the reviewer currently sees. Several re-enter the root `update` with the
 * click Message they stand for, so the root passes itself in.
 */
const pressedShortcut = ({
  model,
  action,
  update,
}: {
  readonly model: Model;
  readonly action: Shortcut;
  readonly update: Update;
}): UpdateReturn => {
  if (action === "escape") {
    if (model.helpOpen) return update({ model, message: Message.ClosedHelp() });
    return { model, commands: [BlurActive()] };
  }
  if (action === "help") return update({ model, message: Message.ToggledHelp() });
  if (model.screen._tag !== "Reviewing" || model.helpOpen) return { model };
  const state = model.screen.state;
  const { visible, selected, selectedIndex } = deriveReview({ state, model });
  const select = (finding: ReviewFindingPayload | undefined): UpdateReturn =>
    finding === undefined
      ? { model }
      : // Focus follows the selection so a screen reader announces the finding that is now shown.
        appendCommands({
          result: persistChange({
            model,
            change: (current) => selectFinding({ model: current, findingId: finding.id }),
          }),
          commands: [RevealSelectedRow(), FocusElement({ selector: DETAIL_HEADING })],
        });
  const decide = (kind: "accept" | "request_changes"): UpdateReturn => {
    if (selected === undefined || state.mode === "calibration") return { model };
    // A decision key acts only on the finding the reviewer selected, never on the first-row fallback,
    // and not while the selection has just moved on its own: a double tap must not decide the next one.
    if (selected.id !== model.selectedFindingId || !model.selectionSettled) return { model };
    const reason =
      kind === "accept"
        ? effectiveReason({ model, finding: selected })
        : draftFor({ model, findingId: selected.id }).reason.trim();
    if (reason.length === 0) return { model, commands: [FocusElement({ selector: ".decision textarea" })] };
    return submit({ model, kind, findingId: selected.id });
  };
  switch (action) {
    case "next":
      return select(visible[selectedIndex + 1] ?? visible[0]);
    case "previous":
      return select(selectedIndex > 0 ? visible[selectedIndex - 1] : visible.at(-1));
    case "accept":
      return decide("accept");
    case "request_changes":
      return decide("request_changes");
    case "open":
      return selected === undefined
        ? { model }
        : update({ model, message: Message.ClickedOpenFinding({ findingId: selected.id }) });
    case "copy":
      return selected === undefined
        ? { model }
        : update({ model, message: Message.ClickedCopyFindingContext({ findingId: selected.id }) });
    case "search":
      return { model, commands: [FocusElement({ selector: ".search__input" })] };
    case "filters":
      return { model, commands: [TogglePopover({ id: "filter-menu" })] };
    case "queue":
      return update({ model, message: Message.SelectedView({ view: "queue" }) });
    case "decisions":
      return update({ model, message: Message.SelectedView({ view: "decisions" }) });
    case "sidebar":
      return update({ model, message: Message.ToggledSidebar() });
    case "guidance":
      return update({ model, message: Message.ToggledGuidance() });
    case "dismiss_toast": {
      const latest = model.toasts.findLast((toast) => toast.phase === "visible");
      return latest === undefined ? { model } : dismissToast({ model, id: latest.id });
    }
  }
  return action satisfies never;
};

/**
 * Idempotent: Escape reaches us both as a keydown and as the dialog's native `cancel`. The dialog leaves the DOM on
 * close, so focus returns to its trigger instead of falling to `<body>`.
 */
const closeHelp = (model: Model): UpdateReturn =>
  model.helpOpen
    ? { model: evo(model, { helpOpen: () => false }), commands: [FocusElement({ selector: HELP_TRIGGER })] }
    : { model };

export const cases = ({
  model,
  update,
}: {
  readonly model: Model;
  readonly update: Update;
}): Handlers<keyof typeof fields> => ({
  PressedShortcut: ({ action }) => pressedShortcut({ model, action, update }),
  ToggledHelp: () =>
    model.helpOpen ? closeHelp(model) : { model: evo(model, { helpOpen: () => true }), commands: [ShowHelp()] },
  ClosedHelp: () => closeHelp(model),
  PerformedDomEffect: () => ({ model }),
});
