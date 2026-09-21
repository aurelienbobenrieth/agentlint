import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../../message";
import type { Model } from "../../model";
import { iconButton } from "../../shared/ui/controls";
import { icon } from "../../shared/ui/icons";

/**
 * Each toast is its own live region: `alert` interrupts for failures, `status` waits its turn. The container carries no
 * `aria-live` so a toast is not announced twice.
 */
export const toasts = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class("toasts"),
      h.Role("region"),
      h.AriaLabel("Notifications"),
      h.OnMouseEnter(Message.HoveredToasts()),
      h.OnMouseLeave(Message.LeftToasts()),
    ],
    model.toasts.map((toast) =>
      h.keyed("div")(
        toast.id,
        [
          h.Class(`toast toast--${toast.tone} toast--${toast.phase}`),
          h.Role(toast.tone === "danger" ? "alert" : "status"),
        ],
        [
          h.span([h.Class("toast__icon")], [icon(toast.tone === "danger" ? "x" : "check", h)]),
          h.p([], [toast.message]),
          iconButton(
            "Dismiss",
            [h.OnClick(Message.ClickedDismissToast({ id: toast.id })), h.Class("icon-btn icon-btn--inline")],
            "x",
            h,
            ["X"],
          ),
        ],
      ),
    ),
  );
