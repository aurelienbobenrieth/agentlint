import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import { type Model, SIDEBAR_MAX, SIDEBAR_MIN } from "../../model";
import { deriveReview } from "../../shared/selectors";
import { button, iconButton } from "../../shared/ui/controls";
import { detail } from "../detail/view";
import { sidebar } from "../list/view";
import { helpDialog } from "../shortcuts/view";
import { toasts } from "../toasts/view";

const topbar = ({
  state,
  model,
  openCount,
  undecidedCount,
  h,
}: {
  readonly state: ReviewStatePayload;
  readonly model: Model;
  readonly openCount: number;
  readonly undecidedCount: number;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.header(
    [h.Class("topbar")],
    [
      iconButton({
        label: "Toggle list",
        attributes: [h.OnClick(Message.ToggledSidebar())],
        name: "panel",
        h,
        keys: ["["],
      }),
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
      ...(model.refreshFailed
        ? [
            button({
              label: "Reload review",
              message: Message.ClickedReloadReview(),
              variant: "secondary",
              h,
              options: { size: "sm" },
            }),
          ]
        : []),
      iconButton({
        label: "Keyboard shortcuts",
        attributes: [h.Id("help-trigger"), h.OnClick(Message.ToggledHelp())],
        name: "keyboard",
        h,
        keys: ["?"],
      }),
      button({
        label: model.finishing ? "Finishing…" : "Finish",
        message: Message.ClickedFinish(),
        variant: "primary",
        h,
        options: {
          size: "sm",
          disabled: model.finishing || model.busyFindingId !== null || (undecidedCount > 0 && state.mode === "review"),
        },
      }),
    ],
  );

const RESIZE_STEP = 16;

/**
 * The window-splitter keys: arrows step, Home and End jump to the limits.
 */
const resizeTarget = ({ key, width }: { readonly key: string; readonly width: number }): number | null => {
  const targets: Readonly<Record<string, number>> = {
    ArrowLeft: width - RESIZE_STEP,
    ArrowRight: width + RESIZE_STEP,
    Home: SIDEBAR_MIN,
    End: SIDEBAR_MAX,
  };
  return targets[key] ?? null;
};

export const reviewView = ({
  state,
  model,
  h,
}: {
  readonly state: ReviewStatePayload;
  readonly model: Model;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const derived = deriveReview({ state, model });
  return h.div(
    [
      h.Class(`shell${model.sidebarOpen ? "" : " shell--collapsed"}${model.resizingSidebar ? " shell--resizing" : ""}`),
      h.Style({ "--sidebar-w": `${model.sidebarWidth}px` }),
    ],
    [
      topbar({ state, model, openCount: derived.openCount, undecidedCount: derived.undecidedCount, h }),
      h.div(
        [h.Class("workspace")],
        [
          sidebar({ state, model, derived, h }),
          h.div(
            [
              h.Class("resizer"),
              h.Role("separator"),
              h.AriaLabel("Resize list"),
              h.AriaOrientation("vertical"),
              h.AriaValuenow(model.sidebarWidth),
              h.AriaValuemin(SIDEBAR_MIN),
              h.AriaValuemax(SIDEBAR_MAX),
              h.Tabindex(0),
              h.OnKeyDownPreventDefault((key) => {
                const width = resizeTarget({ key, width: model.sidebarWidth });
                return width === null ? Option.none() : Option.some(Message.NudgedSidebar({ width }));
              }),
              h.OnPointerDown((_pointerType, pointerButton) =>
                pointerButton === 0 ? Option.some(Message.StartedSidebarResize()) : Option.none(),
              ),
            ],
            [],
          ),
          detail({ state, model, derived, h }),
        ],
      ),
      toasts({ model, h }),
      ...(model.helpOpen ? [helpDialog({ model, h })] : []),
    ],
  );
};
