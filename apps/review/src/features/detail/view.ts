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

const renderCodePanel = (
  finding: ReviewFindingPayload,
  codeView: CodeView,
  canOpen: boolean,
  preferred: EditorApplication | undefined,
  h: HtmlBuilder<Message>,
): Html => {
  const allLines = highlightedLines(finding.code.source, finding.file);
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
                [icon("file", h), h.span([], [`${finding.file}:${finding.line}`]), icon("external", h)],
              )
            : h.span([h.Class("code__file")], [icon("file", h), h.span([], [`${finding.file}:${finding.line}`])]),
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

/** One slot per finding: the panel only re-renders when that finding, the code view, or the editor changes. */
const codePanel = createKeyedLazy();

const diffBlock = (diff: string, file: string, h: HtmlBuilder<Message>): Html =>
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
            : h.span([h.InnerHTML(highlightedLine(code.length === 0 ? " " : code, file))], []),
        ],
      );
    }),
  );

const actorRow = (actor: string, at: string, nowIso: string, verb: string, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class("actor")],
    [
      icon(actorKind(actor) === "agent" ? "sparkle" : "user", h),
      h.span([h.Class("actor__name")], [actorLabel(actor)]),
      h.span([h.Class("actor__verb")], [`${verb} `, h.time([h.Datetime(at), h.Title(at)], [relativeTime(at, nowIso)])]),
    ],
  );

const proposalCard = (
  finding: ReviewFindingPayload,
  state: ReviewStatePayload,
  h: HtmlBuilder<Message>,
): Html | null => {
  const proposal = finding.proposal;
  if (proposal === null) return null;
  return h.section(
    [h.Class("card card--proposal")],
    [
      h.div(
        [h.Class("card__head")],
        [
          h.span([h.Class("card__title")], ["Agent proposal"]),
          actorRow(proposal.actor, proposal.at, state.generatedAt, "proposed", h),
        ],
      ),
      h.p([h.Class("card__text")], [proposal.summary]),
      ...(proposal.diff === null ? [] : [diffBlock(proposal.diff, finding.file, h)]),
    ],
  );
};

const acceptanceCard = (
  finding: ReviewFindingPayload,
  state: ReviewStatePayload,
  h: HtmlBuilder<Message>,
): Html | null => {
  const acceptance = finding.acceptance;
  if (acceptance === null) return null;
  return h.section(
    [h.Class("card card--accepted")],
    [
      h.div(
        [h.Class("card__head")],
        [
          h.span([h.Class("card__title")], [icon("check", h), h.span([], ["Accepted"])]),
          actorRow(acceptance.actor, acceptance.at, state.generatedAt, "accepted", h),
        ],
      ),
      h.p([h.Class("card__text")], [acceptance.reason]),
    ],
  );
};

const lineageCard = (reason: string, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class("card card--lineage")],
    [
      h.div(
        [h.Class("card__head")],
        [
          h.span([h.Class("card__title")], ["Earlier decision on this lineage"]),
          h.span([h.Class("card__hint")], ["No longer applies — the evidence changed"]),
        ],
      ),
      h.p([h.Class("card__text")], [reason]),
    ],
  );

const guidance = (finding: ReviewFindingPayload, model: Model, h: HtmlBuilder<Message>): Html => {
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
        [icon("chevron", h), h.span([], ["Rule guidance"]), ...kbd(["G"], h), h.code([], [finding.ruleId])],
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
                        highlightedLines(example.code, finding.file).map((markup) =>
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
                          [h.span([], [reference.label]), h.code([], [reference.target]), icon("external", h)],
                        );
                  }),
                ),
              ]),
        ],
      ),
    ],
  );
};

const editorMenu = (
  state: ReviewStatePayload,
  finding: ReviewFindingPayload,
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
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
            appIcon(application.id, h),
            h.span([], [application.label]),
            ...(model.preferredApplication === application.id ? [icon("check", h)] : []),
          ],
        ),
      ),
    ],
  );

const detailBar = (
  state: ReviewStatePayload,
  finding: ReviewFindingPayload,
  model: Model,
  derived: ReviewDerivation,
  h: HtmlBuilder<Message>,
): Html => {
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
          iconButton(
            "Previous",
            [
              h.Disabled(previous === undefined),
              ...(previous === undefined ? [] : [h.OnClick(Message.SelectedFinding({ findingId: previous.id }))]),
              h.Class("icon-btn icon-btn--flip"),
            ],
            "arrow",
            h,
            ["K"],
          ),
          iconButton(
            "Next",
            [
              h.Disabled(next === undefined),
              ...(next === undefined ? [] : [h.OnClick(Message.SelectedFinding({ findingId: next.id }))]),
            ],
            "arrow",
            h,
            ["J"],
          ),
        ],
      ),
      h.span([h.Class("detail__spacer")], []),
      ...(canOpen
        ? [
            h.div(
              [h.Class("split")],
              [
                tip(
                  preferred === undefined ? "Open in an application" : `Open in ${preferred.label}`,
                  ["E"],
                  h.button(
                    [
                      h.Type("button"),
                      h.Class("btn btn--secondary btn--sm split__main"),
                      ...(preferred === undefined
                        ? [h.Popovertarget("editor-menu")]
                        : [h.OnClick(Message.ClickedOpenFinding({ findingId: finding.id }))]),
                    ],
                    [
                      preferred === undefined ? icon("external", h) : appIcon(preferred.id, h),
                      h.span([], [preferred === undefined ? "Open in…" : preferred.label]),
                    ],
                  ),
                  h,
                ),
                h.button(
                  [
                    h.Type("button"),
                    h.Class("btn btn--secondary btn--sm split__menu"),
                    h.Popovertarget("editor-menu"),
                    h.AriaLabel("Choose application"),
                  ],
                  [icon("chevron", h)],
                ),
              ],
            ),
            editorMenu(state, finding, model, h),
          ]
        : []),
      tip(
        "Copy finding context for your agent",
        ["C"],
        button("Copy context", Message.ClickedCopyFindingContext({ findingId: finding.id }), "secondary", h, {
          icon: "copy",
          size: "sm",
        }),
        h,
      ),
    ],
  );
};

export const detail = (
  state: ReviewStatePayload,
  model: Model,
  derived: ReviewDerivation,
  h: HtmlBuilder<Message>,
): Html => {
  const finding = derived.selected;
  if (finding === undefined) {
    return h.main([h.Class("detail detail--empty")], [h.p([], ["Select a finding."])]);
  }
  const status = statusFor(derived, finding);
  const canOpen = finding.editor !== null && state.applications.length > 0;
  const preferred = state.applications.find(({ id }) => id === model.preferredApplication);
  const proposal = proposalCard(finding, state, h);
  const acceptance = status === "accepted" || finding.acceptance !== null ? acceptanceCard(finding, state, h) : null;
  return h.main(
    [h.Class("detail")],
    [
      detailBar(state, finding, model, derived, h),
      h.header(
        [h.Class("detail__head")],
        [
          h.div(
            [h.Class("detail__badges")],
            [
              ...(finding.authority === "human"
                ? [h.span([h.Class("badge badge--human")], [icon("user", h), "Human decision"])]
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
          h.h1([], [finding.ruleTitle]),
          h.p([h.Class("detail__lead")], [finding.message]),
          h.p([h.Class("detail__standard")], [finding.guidance.standard]),
        ],
      ),
      codePanel(finding.id, renderCodePanel, [finding, model.codeView, canOpen, preferred, h]),
      ...(proposal === null ? [] : [proposal]),
      ...(acceptance === null ? [] : [acceptance]),
      ...(finding.lineageReason === null ? [] : [lineageCard(finding.lineageReason, h)]),
      decisionForm(state, finding, model, derived, h),
      guidance(finding, model, h),
    ],
  );
};
