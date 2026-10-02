import { independentHidden } from "./selectors";
import { createKeyedLazy, type Html, type HtmlBuilder } from "foldkit/html";

import type {
  EditorApplication,
  FindingStatus,
  ReviewChange,
  ReviewFindingPayload,
  ReviewStatePayload,
} from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { CodeView, Model } from "../../shared/model";
import { type ReviewDerivation, statusFor } from "../../shared/selectors";
import { button, iconButton, kbd, tip } from "../../shared/ui/controls";
import { appIcon, icon } from "../../shared/ui/icons";
import { actorKind, actorLabel, lifecycleLabel, relativeTime, safeExternalHref } from "../../shared/ui/labels";
import { decisionForm } from "../decision/view";
import { fileTree, type FileTreeNode } from "./files";
import { highlightedLine, highlightedLines } from "./syntax";

type CodeLine = {
  readonly number: number | null;
  readonly kind: "context" | "addition" | "deletion" | "gap";
  readonly markup: string;
};

/**
 * The rows of a change, numbered by the new file. A deleted line keeps its old number, shown dimmed.
 */
const changeLines = ({ change, file }: { readonly change: ReviewChange; readonly file: string }): CodeLine[] =>
  change.hunks.flatMap((hunk, index) => {
    const numbers = { old: hunk.oldStart, new: hunk.newStart };
    const gap: CodeLine[] =
      index > 0 || hunk.newStart > 1 ? [{ number: null, kind: "gap", markup: `⋯ line ${hunk.newStart}` }] : [];
    return [
      ...gap,
      ...hunk.lines.map((line): CodeLine => {
        const number = line.kind === "deletion" ? numbers.old++ : numbers.new++;
        if (line.kind === "context") numbers.old++;
        return {
          number,
          kind: line.kind,
          markup: highlightedLine({ source: line.content.length === 0 ? " " : line.content, file }),
        };
      }),
    ];
  });

const renderCodePanel = ({
  finding,
  file,
  source,
  change,
  codeView,
  canOpen,
  preferred,
  h,
}: {
  readonly finding: ReviewFindingPayload;
  readonly file: string;
  readonly source: string;
  readonly change: ReviewChange | undefined;
  readonly codeView: CodeView;
  readonly canOpen: boolean;
  readonly preferred: EditorApplication | undefined;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const allLines = highlightedLines({ source, file });
  const focus = file === finding.file ? finding.code.focus : null;
  const start = focus === null ? 0 : Math.max(1, focus.startLine);
  const end = focus === null ? -1 : Math.max(start, focus.endLine);
  const hasChange = change !== undefined && change.hunks.length > 0;
  // "focused" reads as the narrow view: the change when there is one, else the lines around the finding.
  const narrow = codeView === "focused" && (hasChange || focus !== null);
  const lines: ReadonlyArray<CodeLine> =
    narrow && hasChange
      ? changeLines({ change, file })
      : (() => {
          const first = narrow ? Math.max(1, start - 3) : 1;
          const last = narrow ? Math.min(allLines.length, end + 3) : allLines.length;
          return allLines
            .slice(first - 1, last)
            .map((markup, index): CodeLine => ({ number: first + index, kind: "context", markup }));
        })();
  const location = focus === null ? file : `${file}:${focus.startLine}`;
  const label = [icon({ name: "file", h }), h.span([], [location])];
  return h.section(
    [h.Class("code")],
    [
      h.div(
        [h.Class("code__bar")],
        [
          canOpen && file === finding.file
            ? h.button(
                [
                  h.Type("button"),
                  h.Class("code__file code__file--link"),
                  ...(preferred === undefined
                    ? [h.Popovertarget("editor-menu")]
                    : [h.OnClick(Message.ClickedOpenFinding({ findingId: finding.id }))]),
                  h.Title(preferred === undefined ? "Open in…" : `Open in ${preferred.label}`),
                ],
                [...label, icon({ name: "external", h })],
              )
            : h.span([h.Class("code__file")], label),
          ...(change === undefined
            ? []
            : [h.span([h.Class(`code__status code__status--${change.status}`)], [change.status])]),
          h.span([h.Class("code__spacer")], []),
          ...(hasChange || focus !== null
            ? [
                h.button(
                  [
                    h.Type("button"),
                    h.Class("code__toggle"),
                    h.OnClick(Message.SelectedCodeView({ codeView: narrow ? "full" : "focused" })),
                  ],
                  [narrow ? `Full file · ${allLines.length} lines` : hasChange ? "Changes only" : "Focus"],
                ),
              ]
            : [h.span([h.Class("code__hint")], [`Whole file · ${allLines.length} lines`])]),
        ],
      ),
      h.keyed("pre")(
        `${finding.id}:${file}`,
        [h.Class("code__lines")],
        lines.map((line) => {
          const focused =
            line.kind !== "deletion" && line.number !== null && line.number >= start && line.number <= end;
          return line.kind === "gap"
            ? h.code(
                [h.Class("line line--gap")],
                [h.span([h.Class("line__n")], []), h.span([h.Class("line__c")], [line.markup])],
              )
            : h.code(
                [h.Class(`line line--${line.kind}${focused ? " line--focus" : ""}`)],
                [
                  h.span([h.Class("line__n")], [line.number === null ? "" : String(line.number)]),
                  h.span([h.Class("line__c"), h.InnerHTML(line.markup)], []),
                ],
              );
        }),
      ),
    ],
  );
};

/**
 * One slot per finding: the panel only re-renders when that finding, the viewed file, the code view, or the editor
 * changes.
 */
const codePanel = createKeyedLazy();

const fileRows = ({
  nodes,
  finding,
  viewed,
  state,
  h,
}: {
  readonly nodes: ReadonlyArray<FileTreeNode>;
  readonly finding: ReviewFindingPayload;
  readonly viewed: string;
  readonly state: ReviewStatePayload;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.ul(
    [h.Class("files__list")],
    nodes.map((node) => {
      if (node.kind === "directory") {
        return h.li(
          [h.Class("files__dir")],
          [
            h.span([h.Class("files__dirname"), h.Title(node.name)], [node.name]),
            fileRows({ nodes: node.children, finding, viewed, state, h }),
          ],
        );
      }
      const status = state.changes[node.path]?.status;
      const available = state.sources[node.path] !== undefined;
      return h.li(
        [],
        [
          h.button(
            [
              h.Type("button"),
              h.Class(`files__file${node.path === viewed ? " files__file--active" : ""}`),
              h.Title(node.path),
              h.Disabled(!available),
              ...(node.path === viewed ? [h.AriaCurrent("true")] : []),
              ...(available ? [h.OnClick(Message.SelectedFile({ findingId: finding.id, file: node.path }))] : []),
            ],
            [
              h.span([h.Class("files__name")], [node.name]),
              ...(node.path === finding.file ? [h.span([h.Class("files__flag"), h.Title("Flagged file")], [])] : []),
              ...(status === undefined
                ? []
                : [
                    h.span(
                      [h.Class(`files__status files__status--${status}`), h.Title(status)],
                      [status.charAt(0).toUpperCase()],
                    ),
                  ]),
            ],
          ),
        ],
      );
    }),
  );

const filesRail = ({
  finding,
  viewed,
  state,
  h,
}: {
  readonly finding: ReviewFindingPayload;
  readonly viewed: string;
  readonly state: ReviewStatePayload;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.aside(
    [h.Class("files"), h.AriaLabel("Files to review together")],
    [
      h.h2([h.Class("files__title")], [`Review together · ${finding.relatedFiles.length}`]),
      fileRows({ nodes: fileTree(finding.relatedFiles), finding, viewed, state, h }),
    ],
  );

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

/**
 * The decision in a few words. Who may decide is already the authority badge.
 */
const askHeading = ({
  mode,
  status,
}: {
  readonly mode: ReviewStatePayload["mode"];
  readonly status: FindingStatus;
}): string =>
  mode === "calibration"
    ? "Label it if this rule should flag this code"
    : status === "accepted"
      ? "Accepted · request changes to reopen"
      : status === "changes_requested"
        ? "Sent back · accept only if no change is needed"
        : "Accept if";

/**
 * What to verify before deciding: the rule's checklist, or its standard when it has none.
 */
const ask = ({
  finding,
  state,
  status,
  h,
}: {
  readonly finding: ReviewFindingPayload;
  readonly state: ReviewStatePayload;
  readonly status: FindingStatus;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const criteria = finding.guidance.checks.length > 0 ? finding.guidance.checks : [finding.guidance.standard];
  return h.section(
    [h.Class(`ask ask--${status}`)],
    [
      h.h2([h.Class("ask__heading")], [askHeading({ mode: state.mode, status })]),
      h.ul(
        [h.Class("ask__criteria")],
        criteria.map((criterion) => h.li([], [criterion])),
      ),
    ],
  );
};

/**
 * One row per summary line. A leading `Label:` becomes the row's label, so `Changed:`, `Holds:`, `Check:` line up.
 */
const proposalLines = (summary: string): ReadonlyArray<{ readonly label: string | null; readonly text: string }> =>
  summary
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const labelled = /^([A-Z][A-Za-z ]{0,15}):\s+(.+)$/u.exec(line);
      return labelled ? { label: labelled[1] ?? null, text: labelled[2] ?? line } : { label: null, text: line };
    });

const proposalBlock = ({
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
    [h.Class("proposal")],
    [
      h.div(
        [h.Class("proposal__head")],
        [actorRow({ actor: proposal.actor, at: proposal.at, nowIso: state.generatedAt, verb: "proposed", h })],
      ),
      h.dl(
        [h.Class("proposal__lines")],
        proposalLines(proposal.summary).flatMap(({ label, text }) => [
          h.dt([h.Class("proposal__label")], [label ?? ""]),
          h.dd([h.Class("proposal__text")], [text]),
        ]),
      ),
      ...(proposal.diff === null
        ? []
        : [
            h.details(
              [h.Class("proposal__diff")],
              [h.summary([], ["Proposed diff"]), diffBlock({ diff: proposal.diff, file: finding.file, h })],
            ),
          ]),
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
  // The checklist, or the standard when there is none, already leads the finding as "Accept if".
  const { standard, checks, examples, references } = finding.guidance;
  if (checks.length === 0 && examples.length === 0 && references.length === 0) return h.span([], []);
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
          h.span([h.Class("guidance__chevron")], [icon({ name: "chevron", h })]),
          h.span([], ["Rule guidance"]),
          ...kbd({ keys: ["G"], h }),
          h.code([], [finding.ruleId]),
        ],
      ),
      h.div(
        [h.Class("guidance__body")],
        [
          ...(checks.length === 0 ? [] : [h.p([h.Class("guidance__standard")], [standard])]),
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
  const viewed =
    model.viewedFile?.findingId === finding.id && finding.relatedFiles.includes(model.viewedFile.file)
      ? model.viewedFile.file
      : finding.file;
  const withFiles = finding.relatedFiles.length > 1;
  const acceptance =
    !hidden && (status === "accepted" || finding.acceptance !== null) ? acceptanceCard({ finding, state, h }) : null;
  return h.main(
    [h.Class(`detail${withFiles ? " detail--with-files" : ""}`)],
    [
      detailBar({ state, finding, model, derived, h }),
      h.div(
        [h.Class("detail__body")],
        [
          h.div(
            [h.Class("detail__content")],
            [
              h.header(
                [h.Class("detail__head")],
                [
                  h.div(
                    [h.Class("detail__badges")],
                    [
                      ...(finding.authority === "human"
                        ? [h.span([h.Class("badge badge--human")], [icon({ name: "user", h }), "Human decision"])]
                        : []),
                      h.span([h.Class("badge")], [lifecycleLabel(finding.lifecycle)]),
                      ...(status === "changes_requested"
                        ? [h.span([h.Class("badge badge--danger")], ["Changes requested"])]
                        : []),
                    ],
                  ),
                  // Keyed and focusable: keyboard navigation focuses the heading, and a fresh element per finding
                  // makes a screen reader announce it even when two findings share a rule title.
                  h.keyed("h1")(finding.id, [h.Tabindex(-1)], [finding.ruleTitle]),
                  h.p([h.Class("detail__lead")], [finding.message]),
                  ask({ finding, state, status, h }),
                  ...(hidden ? [] : [proposalBlock({ finding, state, h })].filter((block) => block !== null)),
                ],
              ),
              codePanel(
                finding.id,
                (
                  panelFinding: ReviewFindingPayload,
                  file: string,
                  source: string,
                  change: ReviewChange | undefined,
                  codeView: CodeView,
                  panelCanOpen: boolean,
                  panelPreferred: EditorApplication | undefined,
                  builder: HtmlBuilder<Message>,
                ) =>
                  renderCodePanel({
                    finding: panelFinding,
                    file,
                    source,
                    change,
                    codeView,
                    canOpen: panelCanOpen,
                    preferred: panelPreferred,
                    h: builder,
                  }),
                [
                  finding,
                  viewed,
                  state.sources[viewed] ?? "",
                  state.changes[viewed],
                  model.codeView,
                  canOpen,
                  preferred,
                  h,
                ],
              ),
              ...(acceptance === null ? [] : [acceptance]),
              ...(hidden || finding.lineageReason === null
                ? []
                : [
                    lineageCard({ reason: finding.lineageReason, invalidationReasons: finding.invalidationReasons, h }),
                  ]),
              ...(model.independentReview && !hidden
                ? [h.p([h.Class("card__text")], ["Independent assessment: ", model.independentNotes[finding.id] ?? ""])]
                : []),
              decisionForm({ state, finding, model, derived, h }),
              guidance({ finding, model, h }),
            ],
          ),
          ...(withFiles ? [filesRail({ finding, viewed, state, h })] : []),
        ],
      ),
    ],
  );
};
