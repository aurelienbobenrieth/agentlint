import { evo } from "foldkit/struct";

import type { ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Model, Shortcut } from "../../model";
import { deriveReview } from "../../shared/selectors";
import { appendCommands, type Handlers, type UpdateReturn } from "../../shared/update";
import { effectiveReason } from "../decision/selectors";
import { submit } from "../decision/update";
import { persistChange } from "../session/update";
import { dismissToast } from "../toasts/update";
import { BlurActive, FocusElement, RevealSelectedRow, ShowHelp, TogglePopover } from "./command";
import type { fields } from "./messages";

type Update = (model: Model, message: Message) => UpdateReturn;

/** Keyboard shortcuts resolve against what the reviewer currently sees. Several re-enter the root
 *  `update` with the click Message they stand for, so the root passes itself in. */
const pressedShortcut = (model: Model, action: Shortcut, update: Update): UpdateReturn => {
  if (action === "escape") {
    if (model.helpOpen) return update(model, Message.ToggledHelp());
    return { model, commands: [BlurActive()] };
  }
  if (action === "help") return update(model, Message.ToggledHelp());
  if (model.screen._tag !== "Reviewing" || model.helpOpen) return { model };
  const state = model.screen.state;
  const { visible, selected, selectedIndex } = deriveReview(state, model);
  const select = (finding: ReviewFindingPayload | undefined): UpdateReturn =>
    finding === undefined
      ? { model }
      : appendCommands(
          persistChange(model, (current) => evo(current, { selectedFindingId: () => finding.id })),
          [RevealSelectedRow()],
        );
  const decide = (kind: "accept" | "request_changes"): UpdateReturn => {
    if (selected === undefined || state.mode === "calibration") return { model };
    if (kind === "accept" && effectiveReason(model, selected).length === 0) {
      return { model, commands: [FocusElement({ selector: ".decision textarea" })] };
    }
    return submit(model, kind, selected.id);
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
      return selected === undefined ? { model } : update(model, Message.ClickedOpenFinding({ findingId: selected.id }));
    case "copy":
      return selected === undefined
        ? { model }
        : update(model, Message.ClickedCopyFindingContext({ findingId: selected.id }));
    case "search":
      return { model, commands: [FocusElement({ selector: ".search__input" })] };
    case "filters":
      return { model, commands: [TogglePopover({ id: "filter-menu" })] };
    case "queue":
      return update(model, Message.SelectedView({ view: "queue" }));
    case "decisions":
      return update(model, Message.SelectedView({ view: "decisions" }));
    case "sidebar":
      return update(model, Message.ToggledSidebar());
    case "guidance":
      return update(model, Message.ToggledGuidance());
    case "dismiss_toast": {
      const latest = model.toasts.findLast((toast) => toast.phase === "visible");
      return latest === undefined ? { model } : dismissToast(model, latest.id);
    }
  }
};

export const cases = (model: Model, update: Update): Handlers<keyof typeof fields> => ({
  PressedShortcut: ({ action }) => pressedShortcut(model, action, update),
  ToggledHelp: () => ({
    model: evo(model, { helpOpen: (open) => !open }),
    commands: model.helpOpen ? [] : [ShowHelp()],
  }),
  PerformedDomEffect: () => ({ model }),
});
