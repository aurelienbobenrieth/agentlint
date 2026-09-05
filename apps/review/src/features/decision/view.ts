import type { Html, HtmlBuilder } from "foldkit/html";

import type { ReviewFindingPayload, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Model } from "../../model";
import { draftFor, type ReviewDerivation, statusFor } from "../../shared/selectors";
import { button, tip } from "../../shared/ui/controls";
import { icon } from "../../shared/ui/icons";
import { statusLabel } from "../../shared/ui/labels";

/** Only the selected finding renders a decision form, so keyboard focus can target `.decision textarea`. */
export const decisionForm = (
  state: ReviewStatePayload,
  finding: ReviewFindingPayload,
  model: Model,
  derived: ReviewDerivation,
  h: HtmlBuilder<Message>,
): Html => {
  const draft = draftFor(model, finding.id);
  const busy = model.busyFindingId !== null;
  const status = statusFor(derived, finding);
  const reasonId = `reason-${finding.id}`;
  const empty = draft.reason.trim().length === 0 && finding.proposal === null;

  if (state.mode === "calibration") {
    const choices = [
      ["applies", "Applies"],
      ["does_not_apply", "Does not apply"],
      ["unsure", "Unsure"],
    ] as const;
    return h.section(
      [h.Class("decision")],
      [
        h.div(
          [h.Class("segment"), h.Role("group"), h.AriaLabel("Calibration")],
          choices.map(([value, label]) =>
            h.button(
              [
                h.Type("button"),
                h.OnClick(Message.SelectedCalibration({ findingId: finding.id, calibration: value })),
                h.Class(`segment__item${draft.calibration === value ? " segment__item--active" : ""}`),
                h.AriaPressed(draft.calibration === value ? "true" : "false"),
              ],
              [label],
            ),
          ),
        ),
        h.textarea([
          h.Id(`note-${finding.id}`),
          h.Class("textarea"),
          h.Value(draft.note),
          h.OnInput((value) => Message.UpdatedNote({ findingId: finding.id, value })),
          h.Placeholder("Note for the rule author (optional)"),
          h.AriaLabel("Calibration note"),
          h.Rows(2),
        ]),
        h.div(
          [h.Class("decision__actions")],
          [
            button(
              busy ? "Saving…" : "Save label",
              Message.ClickedSaveCalibration({ findingId: finding.id }),
              "primary",
              h,
              { disabled: busy || draft.calibration === "unreviewed" },
            ),
          ],
        ),
      ],
    );
  }

  if (status === "accepted" && finding.authority === "agent" && draft.disposition === "none") {
    // Decisions view: an agent already accepted this. The human can only push back.
    return h.section(
      [h.Class("decision")],
      [
        h.textarea([
          h.Id(reasonId),
          h.Class("textarea"),
          h.Value(draft.reason),
          h.OnInput((value) => Message.UpdatedReason({ findingId: finding.id, value })),
          h.Placeholder("What should change?"),
          h.AriaLabel("Requested correction"),
          h.Rows(2),
        ]),
        h.div(
          [h.Class("decision__actions")],
          [
            button("Request correction", Message.ClickedRequestChanges({ findingId: finding.id }), "danger", h, {
              disabled: busy,
            }),
          ],
        ),
      ],
    );
  }

  const detached = state.transport === "detached";
  const acceptLabel = busy
    ? "Saving…"
    : detached && draft.disposition === "accept"
      ? "Update acceptance"
      : finding.proposal === null || finding.proposal.diff === null
        ? "Accept"
        : "Accept proposal";
  const changesLabel = detached && draft.disposition === "request_changes" ? "Update request" : "Request changes";
  return h.section(
    [h.Class("decision")],
    [
      h.textarea([
        h.Id(reasonId),
        h.Class("textarea"),
        h.Value(draft.reason),
        h.OnInput((value) => Message.UpdatedReason({ findingId: finding.id, value })),
        h.Placeholder(
          finding.proposal === null
            ? "Why is this acceptable? (required to accept)"
            : "Optional note — accepting records the proposal as the reason",
        ),
        h.AriaLabel("Reason or requested change"),
        h.Rows(2),
      ]),
      h.div(
        [h.Class("decision__actions")],
        [
          tip(
            "Accept",
            ["A"],
            button(acceptLabel, Message.ClickedAccept({ findingId: finding.id }), "primary", h, {
              disabled: busy || empty,
            }),
            h,
          ),
          tip(
            "Request changes",
            ["R"],
            button(changesLabel, Message.ClickedRequestChanges({ findingId: finding.id }), "danger", h, {
              disabled: busy,
            }),
            h,
          ),
          ...((status === "accepted" || status === "changes_requested") && (!detached || draft.disposition !== "none")
            ? [
                h.span(
                  [h.Class(`decision__status decision__status--${status}`)],
                  [
                    icon(status === "accepted" ? "check" : "x", h),
                    statusLabel(status, state.mode),
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(Message.ClickedWithdraw({ findingId: finding.id })),
                        h.Class("decision__undo"),
                        h.Disabled(busy),
                      ],
                      ["Undo"],
                    ),
                  ],
                ),
              ]
            : []),
        ],
      ),
    ],
  );
};
