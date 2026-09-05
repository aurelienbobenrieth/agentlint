import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Model } from "../../model";
import { deriveReview } from "../../shared/selectors";
import { button, iconButton } from "../../shared/ui/controls";
import { detail } from "../detail/view";
import { sidebar } from "../list/view";
import { helpDialog } from "../shortcuts/view";
import { toasts } from "../toasts/view";

const topbar = (
  state: ReviewStatePayload,
  model: Model,
  openCount: number,
  undecidedCount: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.header(
    [h.Class("topbar")],
    [
      iconButton(model.sidebarOpen ? "Hide list" : "Show list", [h.OnClick(Message.ToggledSidebar())], "panel", h, [
        "[",
      ]),
      h.span([h.Class("brand")], ["agentlint"]),
      h.span(
        [
          h.Class("badge"),
          h.Title(`${state.coverage.files.length} files; ${state.coverage.rules.length} bindings executed`),
        ],
        [state.coverage.scope === "complete" ? "Complete scan" : "Partial scan"],
      ),
      h.span(
        [h.Class("crumb")],
        [
          h.span([h.Class("crumb__project")], [state.project]),
          h.span([h.Class("crumb__sep")], ["/"]),
          h.span([h.Class("crumb__base")], [state.base]),
        ],
      ),
      ...(state.mode === "calibration" ? [h.span([h.Class("badge")], ["Calibration"])] : []),
      ...(state.transport === "detached"
        ? [
            h.span(
              [h.Class("badge"), h.Title("Decisions stay in this browser until you finish and export them.")],
              ["Browser-local"],
            ),
          ]
        : []),
      h.span([h.Class("topbar__spacer")], []),
      h.span(
        [h.Class(`gate${openCount === 0 && state.mode === "review" ? " gate--open" : ""}`)],
        [
          state.mode === "calibration"
            ? `${openCount} to calibrate`
            : openCount === 0
              ? state.transport === "detached"
                ? "Decisions prepared"
                : "Gate open"
              : `${openCount} unresolved`,
        ],
      ),
      iconButton("Keyboard shortcuts", [h.OnClick(Message.ToggledHelp())], "keyboard", h, ["?"]),
      button("Finish", Message.ClickedFinish(), "primary", h, {
        size: "sm",
        disabled: model.busyFindingId !== null || (undecidedCount > 0 && state.mode === "review"),
      }),
    ],
  );

export const reviewView = (state: ReviewStatePayload, model: Model, h: HtmlBuilder<Message>): Html => {
  const derived = deriveReview(state, model);
  return h.div(
    [
      h.Class(`shell${model.sidebarOpen ? "" : " shell--collapsed"}${model.resizingSidebar ? " shell--resizing" : ""}`),
      h.Style({ "--sidebar-w": `${model.sidebarWidth}px` }),
    ],
    [
      topbar(state, model, derived.openCount, derived.undecidedCount, h),
      h.div(
        [h.Class("workspace")],
        [
          sidebar(state, model, derived, h),
          h.div(
            [
              h.Class("resizer"),
              h.Role("separator"),
              h.AriaLabel("Resize list"),
              h.OnPointerDown((_pointerType, pointerButton) =>
                pointerButton === 0 ? Option.some(Message.StartedSidebarResize()) : Option.none(),
              ),
            ],
            [],
          ),
          detail(state, model, derived, h),
        ],
      ),
      toasts(model, h),
      ...(model.helpOpen ? [helpDialog(model, h)] : []),
    ],
  );
};
