import { independentHidden } from "../detail/selectors";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { ReviewFindingPayload, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Model } from "../../model";
import { draftFor, type ReviewDerivation, statusFor } from "../../shared/selectors";
import { button, tip } from "../../shared/ui/controls";
import { icon } from "../../shared/ui/icons";
import { statusLabel } from "../../shared/ui/labels";

/**
 * Only the selected finding renders a decision form, so keyboard focus can target `.decision textarea`.
 */
export const decisionForm = ({
  state,
  finding,
  model,
  derived,
  h,
}: {
  readonly state: ReviewStatePayload;
  readonly finding: ReviewFindingPayload;
  readonly model: Model;
  readonly derived: ReviewDerivation;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const draft = draftFor({ model, findingId: finding.id });
  const busy = model.busyFindingId !== null;
  const status = statusFor({ derived, finding });
  const reasonId = `reason-${finding.id}`;
  const empty = draft.reason.trim().length === 0 && finding.proposal === null;
  const reasonInput = ({ placeholder, label }: { placeholder: string; label: string }): Html =>
    h.textarea([
      h.Id(reasonId),
      h.Class("textarea"),
      h.Value(draft.reason),
      h.OnInput((value) => Message.UpdatedReason({ findingId: finding.id, value })),
      h.Placeholder(placeholder),
      h.AriaLabel(label),
      h.Rows(2),
    ]);

  if (state.mode === "review" && independentHidden({ model, findingId: finding.id })) {
    return h.section(
      [h.Class("decision")],
      [
        h.p(
          [],
          [
            "Review the standard and code first. Previous reasons and proposals remain hidden until you write your assessment.",
          ],
        ),
        h.textarea([
          h.Class("textarea"),
          h.AriaLabel("Independent assessment"),
          h.Placeholder("Your assessment of the code against this standard"),
          h.Rows(3),
          h.Value(model.independentNotes[finding.id] ?? ""),
          h.OnInput((value) => Message.UpdatedIndependentNote({ findingId: finding.id, value })),
        ]),
        button({
          label: "Reveal prior decisions",
          message: Message.RevealedPriorDecision({ findingId: finding.id }),
          variant: "secondary",
          h,
          options: {
            disabled: !model.independentNotes[finding.id]?.trim(),
          },
        }),
      ],
    );
  }
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
        ...(draft.calibration === "does_not_apply"
          ? [
              h.div(
                [h.Class("calibration-reasons"), h.Role("group"), h.AriaLabel("Why does this not apply?")],
                (
                  [
                    ["scope", "Wrong scope"],
                    ["detector", "Wrong match"],
                    ["guidance", "Unclear standard"],
                    ["valid_exception", "Valid exception"],
                    ["other", "Other"],
                  ] as const
                ).map(([reason, label]) =>
                  h.button(
                    [
                      h.Type("button"),
                      h.Class(`chip${draft.calibrationReason === reason ? " chip--active" : ""}`),
                      h.AriaPressed(draft.calibrationReason === reason ? "true" : "false"),
                      h.OnClick(Message.SelectedCalibrationReason({ findingId: finding.id, reason })),
                    ],
                    [label],
                  ),
                ),
              ),
            ]
          : []),
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
            button({
              label: busy ? "Saving…" : "Save label",
              message: Message.ClickedSaveCalibration({ findingId: finding.id }),
              variant: "primary",
              h,
              options: {
                disabled:
                  busy ||
                  draft.calibration === "unreviewed" ||
                  (draft.calibration === "does_not_apply" && draft.calibrationReason === null),
              },
            }),
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
        reasonInput({ placeholder: "What should change?", label: "Requested correction" }),
        h.div(
          [h.Class("decision__actions")],
          [
            button({
              label: "Request correction",
              message: Message.ClickedRequestChanges({ findingId: finding.id }),
              variant: "danger",
              h,
              options: {
                disabled: busy,
              },
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
      reasonInput({
        placeholder:
          finding.proposal === null
            ? "Why is this acceptable? (required to accept)"
            : "Optional note — accepting records the proposal as the reason",
        label: "Reason or requested change",
      }),
      h.div(
        [h.Class("decision__actions")],
        [
          tip({
            label: "Accept",
            keys: ["A"],
            trigger: button({
              label: acceptLabel,
              message: Message.ClickedAccept({ findingId: finding.id }),
              variant: "primary",
              h,
              options: {
                disabled: busy || empty,
              },
            }),
            h,
          }),
          tip({
            label: "Request changes",
            keys: ["R"],
            trigger: button({
              label: changesLabel,
              message: Message.ClickedRequestChanges({ findingId: finding.id }),
              variant: "danger",
              h,
              options: {
                disabled: busy,
              },
            }),
            h,
          }),
          ...((status === "accepted" || status === "changes_requested") && (!detached || draft.disposition !== "none")
            ? [
                h.span(
                  [h.Class(`decision__status decision__status--${status}`)],
                  [
                    icon({ name: status === "accepted" ? "check" : "x", h }),
                    statusLabel({ status, mode: state.mode }),
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
