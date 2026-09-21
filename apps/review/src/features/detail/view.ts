import { independentHidden } from "./selectors";
import { createKeyedLazy, type Html, type HtmlBuilder } from "foldkit/html";

import type { EditorApplication, ReviewFindingPayload, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { CodeView, Model } from "../../model";
import { type ReviewDerivation, statusFor } from "../../shared/selectors";
import { button, iconButton, kbd, tip } from "../../shared/ui/controls";
import { appIcon, icon } from "../../shared/ui/icons";
import { actorKind, actorLabel, relativeTime, safeExternalHref } from "../../shared/ui/labels";
import { decisionForm } from "../decision/view";
import { highlightedLine, highlightedLines } from "./syntax";

const renderCodePanel = ({
  finding,
  source,
  codeView,
  canOpen,
  preferred,
  h,
}: {
  readonly finding: ReviewFindingPayload;
  readonly source: string;
  readonly codeView: CodeView;
  readonly canOpen: boolean;
  readonly preferred: EditorApplication | undefined;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const allLines = highlightedLines({ source, file: finding.file });
  const start = Math.max(1, finding.code.focus.startLine);
  const end = Math.max(start, finding.code.focus.endLine);
  const first = codeView === "full" ? 1 : Math.max(1, start - 3);
  const last = codeView === "full" ? allLines.length : Math.min(allLines.length, end + 3);
  const lines = allLines.slice(first - 1, last);
  return h.section(
    [h.Class("code")],
    [
      h.div(
        [h.Class("code__bar")],
        [
          canOpen
            ? h.button(
                [
                  h.Type("button"),
                  h.Class("code__file code__file--link"),
                  ...(preferred === undefined
                    ? [h.Popovertarget("editor-menu")]
                    : [h.OnClick(Message.ClickedOpenFinding({ findingId: finding.id }))]),
                  h.Title(preferred === undefined ? "Open in…" : `Open in ${preferred.label}`),
                ],
                [
                  icon({ name: "file", h }),
                  h.span([], [`${finding.file}:${finding.line}`]),
                  icon({ name: "external", h }),
                ],
              )
            : h.span(
                [h.Class("code__file")],
                [icon({ name: "file", h }), h.span([], [`${finding.file}:${finding.line}`])],
              ),
          h.button(
            [
              h.Type("button"),
              h.Class("code__toggle"),
              h.OnClick(Message.SelectedCodeView({ codeView: codeView === "full" ? "focused" : "full" })),
            ],
            [codeView === "full" ? "Focus" : `Full file · ${allLines.length} lines`],
          ),
        ],
      ),
      h.keyed("pre")(
        finding.id,
        [h.Class("code__lines")],
        lines.map((markup, index) => {
          const number = first + index;
          const focused = number >= start && number <= end;
          return h.code(
            [h.Class(`line${focused ? " line--focus" : ""}`)],
            [h.span([h.Class("line__n")], [String(number)]), h.span([h.Class("line__c"), h.InnerHTML(markup)], [])],
          );
        }),
      ),
    ],
  );
};

/**
 * One slot per finding: the panel only re-renders when that finding, the code view, or the editor changes.
 */
const codePanel = createKeyedLazy();

const diffBlock = ({
  diff,
  file,
  h,
}: {
  readonly diff: string;
  readonly file: string;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.pre(
    [h.Class("diff")],
    diff.split(/\r?\n/u).map((line) => {
      const kind =
        line.startsWith("+++") || line.startsWith("---")
          ? "meta"
          : line.startsWith("+")
            ? "add"
            : line.startsWith("-")
              ? "del"
              : line.startsWith("@@")
                ? "hunk"
                : "ctx";
      const code = kind === "add" || kind === "del" || kind === "ctx" ? line.slice(1) : line;
      const marker = kind === "add" ? "+" : kind === "del" ? "-" : " ";
      return h.code(
        [h.Class(`diff__line diff__line--${kind}`)],
        [
          h.span([h.Class("diff__marker")], [marker]),
          kind === "meta" || kind === "hunk"
            ? h.span([], [line])
            : h.span([h.InnerHTML(highlightedLine({ source: code.length === 0 ? " " : code, file }))], []),
        ],
      );
    }),
  );

const actorRow = ({
  actor,
  at,
  nowIso,
  verb,
  h,
}: {
  readonly actor: string;
  readonly at: string;
  readonly nowIso: string;
  readonly verb: string;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.span(
    [h.Class("actor")],
    [
      icon({ name: actorKind(actor) === "agent" ? "sparkle" : "user", h }),
      h.span([h.Class("actor__name")], [actorLabel(actor)]),
      h.span(
        [h.Class("actor__verb")],
        [`${verb} `, h.time([h.Datetime(at), h.Title(at)], [relativeTime({ iso: at, nowIso })])],
      ),
    ],
  );

const proposalCard = ({
  finding,
  state,
  h,
}: {
  readonly finding: ReviewFindingPayload;
  readonly state: ReviewStatePayload;
  readonly h: HtmlBuilder<Message>;
}): Html | null => {
  const proposal = finding.proposal;
  if (proposal === null) return null;
  return h.section(
    [h.Class("card card--proposal")],
    [
      h.div(
        [h.Class("card__head")],
        [
          h.span([h.Class("card__title")], ["Agent proposal"]),
          actorRow({ actor: proposal.actor, at: proposal.at, nowIso: state.generatedAt, verb: "proposed", h }),
        ],
      ),
      h.p([h.Class("card__text")], [proposal.summary]),
      ...(proposal.diff === null ? [] : [diffBlock({ diff: proposal.diff, file: finding.file, h })]),
    ],
  );
};

const acceptanceCard = ({
  finding,
  state,
  h,
}: {
  readonly finding: ReviewFindingPayload;
  readonly state: ReviewStatePayload;
  readonly h: HtmlBuilder<Message>;
}): Html | null => {
  const acceptance = finding.acceptance;
  if (acceptance === null) return null;
  return h.section(
    [h.Class("card card--accepted")],
    [
      h.div(
        [h.Class("card__head")],
        [
          h.span([h.Class("card__title")], [icon({ name: "check", h }), h.span([], ["Accepted"])]),
          actorRow({
            actor: acceptance.actor,
            at: acceptance.at,
            nowIso: state.generatedAt,
            verb: `accepted with ${acceptance.authority} authority (declared identity)`,
            h,
          }),
        ],
      ),
      h.p([h.Class("card__text")], [acceptance.reason]),
    ],
  );
};

const lineageCard = ({
  reason,
  invalidationReasons,
  h,
}: {
  readonly reason: string;
  readonly invalidationReasons: ReadonlyArray<string>;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.section(
    [h.Class("card card--lineage")],
    [
      h.div(
        [h.Class("card__head")],
        [
          h.span([h.Class("card__title")], ["Earlier decision on this lineage"]),
          h.span(
            [h.Class("card__hint")],
            [invalidationReasons.length > 0 ? "No longer applies" : "No longer applies — the evidence changed"],
          ),
        ],
      ),
      ...invalidationReasons.map((invalidation) => h.p([h.Class("card__note")], [invalidation])),
      h.p([h.Class("card__text")], [reason]),
    ],
  );

const guidance = ({
  finding,
  model,
  h,
}: {
  readonly finding: ReviewFindingPayload;
  readonly model: Model;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const { checks, examples, references } = finding.guidance;
  const hasBody = checks.length > 0 || examples.length > 0 || references.length > 0;
  if (!hasBody) return h.span([], []);
  return h.details(
    [
      h.Class("guidance"),
      h.Open(model.guidanceOpen),
      h.OnToggle((isOpen) => Message.SetGuidanceOpen({ open: isOpen })),
    ],
    [
      h.summary(
        [h.Class("guidance__summary")],
        [
          icon({ name: "chevron", h }),
          h.span([], ["Rule guidance"]),
          ...kbd({ keys: ["G"], h }),
          h.code([], [finding.ruleId]),
        ],
      ),
      h.div(
        [h.Class("guidance__body")],
        [
          ...(checks.length === 0
            ? []
            : [
                h.h4([], ["Checklist"]),
                h.ul(
                  [h.Class("checklist")],
                  checks.map((check) => h.li([], [check])),
                ),
              ]),
          ...(examples.length === 0
            ? []
            : [
                h.h4([], ["Accepted patterns"]),
                ...examples.map((example) =>
                  h.div(
                    [h.Class("example")],
                    [
                      ...(example.label === null ? [] : [h.span([h.Class("example__label")], [example.label])]),
                      ...(example.description === null ? [] : [h.p([], [example.description])]),
                      h.pre(
                        [h.Class("example__code")],
                        highlightedLines({ source: example.code, file: finding.file }).map((markup) =>
                          h.code([h.Class("example__line"), h.InnerHTML(markup)], []),
                        ),
                      ),
                    ],
                  ),
                ),
              ]),
          ...(references.length === 0
            ? []
            : [
                h.h4([], ["References"]),
                h.div(
                  [h.Class("refs")],
                  references.map((reference) => {
                    const href = safeExternalHref(reference.href);
                    return href === null
                      ? h.span(
                          [h.Class("ref ref--static")],
                          [h.span([], [reference.label]), h.code([], [reference.target])],
                        )
                      : h.a(
                          [h.Href(href), h.Target("_blank"), h.Rel("noopener noreferrer"), h.Class("ref")],
                          [
                            h.span([], [reference.label]),
                            h.code([], [reference.target]),
                            icon({ name: "external", h }),
                          ],
                        );
                  }),
                ),
              ]),
        ],
      ),
    ],
  );
};

const editorMenu = ({
  state,
  finding,
  model,
  h,
}: {
  readonly state: ReviewStatePayload;
  readonly finding: ReviewFindingPayload;
  readonly model: Model;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.div(
    [h.Id("editor-menu"), h.Class("popover popover--menu"), h.Popover("auto")],
    [
      h.span([h.Class("popover__label")], ["Open with"]),
      ...state.applications.map((application) =>
        h.button(
          [
            h.Type("button"),
            h.OnClick(Message.SelectedEditorApplication({ findingId: finding.id, application: application.id })),
            h.Popovertarget("editor-menu"),
            h.Popovertargetaction("hide"),
            h.Class(`menu-item${model.preferredApplication === application.id ? " menu-item--active" : ""}`),
          ],
          [
            appIcon({ application: application.id, h }),
            h.span([], [application.label]),
            ...(model.preferredApplication === application.id ? [icon({ name: "check", h })] : []),
          ],
        ),
      ),
    ],
  );

const detailBar = ({
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
  const previous = derived.selectedIndex > 0 ? derived.visible[derived.selectedIndex - 1] : undefined;
  const next = derived.visible[derived.selectedIndex + 1];
  const canOpen = finding.editor !== null && state.applications.length > 0;
  const preferred = state.applications.find(({ id }) => id === model.preferredApplication);
  return h.div(
    [h.Class("detail__bar")],
    [
      h.span([h.Class("detail__position")], [`${derived.selectedIndex + 1} / ${derived.visible.length}`]),
      h.div(
        [h.Class("detail__nav")],
        [
          iconButton({
            label: "Previous",
            attributes: [
              h.Disabled(previous === undefined),
              ...(previous === undefined ? [] : [h.OnClick(Message.SelectedFinding({ findingId: previous.id }))]),
              h.Class("icon-btn icon-btn--flip"),
            ],
            name: "arrow",
            h,
            keys: ["K"],
          }),
          iconButton({
            label: "Next",
            attributes: [
              h.Disabled(next === undefined),
              ...(next === undefined ? [] : [h.OnClick(Message.SelectedFinding({ findingId: next.id }))]),
            ],
            name: "arrow",
            h,
            keys: ["J"],
          }),
        ],
      ),
      h.span([h.Class("detail__spacer")], []),
      ...(canOpen
        ? [
            h.div(
              [h.Class("split")],
              [
                tip({
                  label: preferred === undefined ? "Open in an application" : `Open in ${preferred.label}`,
                  keys: ["E"],
                  trigger: h.button(
                    [
                      h.Type("button"),
                      h.Class("btn btn--secondary btn--sm split__main"),
                      ...(preferred === undefined
                        ? [h.Popovertarget("editor-menu")]
                        : [h.OnClick(Message.ClickedOpenFinding({ findingId: finding.id }))]),
                    ],
                    [
                      preferred === undefined
                        ? icon({ name: "external", h })
                        : appIcon({ application: preferred.id, h }),
                      h.span([], [preferred === undefined ? "Open in…" : preferred.label]),
                    ],
                  ),
                  h,
                }),
                h.button(
                  [
                    h.Type("button"),
                    h.Class("btn btn--secondary btn--sm split__menu"),
                    h.Popovertarget("editor-menu"),
                    h.AriaLabel("Choose application"),
                  ],
                  [icon({ name: "chevron", h })],
                ),
              ],
            ),
            editorMenu({ state, finding, model, h }),
          ]
        : []),
      tip({
        label: "Copy finding context for your agent",
        keys: ["C"],
        trigger: button({
          label: "Copy context",
          message: Message.ClickedCopyFindingContext({ findingId: finding.id }),
          variant: "secondary",
          h,
          options: {
            icon: "copy",
            size: "sm",
          },
        }),
        h,
      }),
    ],
  );
};

export const detail = ({
  state,
  model,
  derived,
  h,
}: {
  readonly state: ReviewStatePayload;
  readonly model: Model;
  readonly derived: ReviewDerivation;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const finding = derived.selected;
  if (finding === undefined) {
    return h.main([h.Class("detail detail--empty")], [h.p([], ["Select a finding."])]);
  }
  const status = statusFor({ derived, finding });
  const canOpen = finding.editor !== null && state.applications.length > 0;
  const preferred = state.applications.find(({ id }) => id === model.preferredApplication);
  const hidden = independentHidden({ model, findingId: finding.id });
  const proposal = hidden ? null : proposalCard({ finding, state, h });
  const acceptance =
    !hidden && (status === "accepted" || finding.acceptance !== null) ? acceptanceCard({ finding, state, h }) : null;
  return h.main(
    [h.Class("detail")],
    [
      detailBar({ state, finding, model, derived, h }),
      h.header(
        [h.Class("detail__head")],
        [
          h.div(
            [h.Class("detail__badges")],
            [
              ...(finding.authority === "human"
                ? [h.span([h.Class("badge badge--human")], [icon({ name: "user", h }), "Human decision"])]
                : []),
              h.span(
                [h.Class("badge")],
                [finding.lifecycle === "change" ? "Introduced by this change" : "Current code"],
              ),
              ...(status === "changes_requested"
                ? [h.span([h.Class("badge badge--danger")], ["Changes requested"])]
                : []),
            ],
          ),
          // Keyed and focusable: keyboard navigation focuses the heading, and a fresh element per finding
          // makes a screen reader announce it even when two findings share a rule title.
          h.keyed("h1")(finding.id, [h.Tabindex(-1)], [finding.ruleTitle]),
          h.p([h.Class("detail__lead")], [finding.message]),
          h.p([h.Class("detail__standard")], [finding.guidance.standard]),
          ...(finding.relatedFiles.length > 1
            ? [h.p([h.Class("related-files")], ["Review together: ", finding.relatedFiles.join(", ")])]
            : []),
        ],
      ),
      codePanel(
        finding.id,
        (
          panelFinding: ReviewFindingPayload,
          source: string,
          codeView: CodeView,
          panelCanOpen: boolean,
          panelPreferred: EditorApplication | undefined,
          builder: HtmlBuilder<Message>,
        ) =>
          renderCodePanel({
            finding: panelFinding,
            source,
            codeView,
            canOpen: panelCanOpen,
            preferred: panelPreferred,
            h: builder,
          }),
        [finding, state.sources[finding.file] ?? "", model.codeView, canOpen, preferred, h],
      ),
      ...(proposal === null ? [] : [proposal]),
      ...(acceptance === null ? [] : [acceptance]),
      ...(hidden || finding.lineageReason === null
        ? []
        : [lineageCard({ reason: finding.lineageReason, invalidationReasons: finding.invalidationReasons, h })]),
      ...(model.independentReview && !hidden
        ? [h.p([h.Class("card__text")], ["Independent assessment: ", model.independentNotes[finding.id] ?? ""])]
        : []),
      decisionForm({ state, finding, model, derived, h }),
      guidance({ finding, model, h }),
    ],
  );
};
