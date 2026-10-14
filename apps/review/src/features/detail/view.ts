import { independentHidden } from "./selectors";
import { type Html, type HtmlBuilder } from "foldkit/html";

import type { ReviewFindingPayload, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Model } from "../../shared/model";
import { findingNeighbours, type ReviewDerivation, statusFor } from "../../shared/selectors";
import { button, iconButton, kbd, tip } from "../../shared/ui/controls";
import { agentLabel, agentMarkFor, agentMarkIcon } from "../../shared/ui/agents";
import { appIcon, icon } from "../../shared/ui/icons";
import { actorKind, actorLabel, lifecycleLabel, relativeTime, safeExternalHref } from "../../shared/ui/labels";
import { decisionForm } from "../decision/view";
import { directoryPaths, fileTree, type FileTreeNode } from "./files";
import { highlightedLine, highlightedLines } from "./syntax";
import { fileCode } from "./code-view";

const fileRows = ({
  nodes,
  finding,
  viewed,
  collapsed,
  state,
  h,
}: {
  readonly nodes: ReadonlyArray<FileTreeNode>;
  readonly finding: ReviewFindingPayload;
  readonly viewed: string;
  readonly collapsed: ReadonlyArray<string>;
  readonly state: ReviewStatePayload;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.ul(
    [h.Class("files__list")],
    nodes.map((node) => {
      if (node.kind === "directory") {
        const open = !collapsed.includes(node.path);
        return h.li(
          [h.Class("files__dir")],
          [
            h.button(
              [
                h.Type("button"),
                h.Class(`files__dirname${open ? " files__dirname--open" : ""}`),
                h.Title(node.path),
                h.AriaExpanded(open),
                h.OnClick(Message.ToggledFileDirectory({ path: node.path })),
              ],
              [
                h.span([h.Class("files__chevron")], [icon({ name: "chevron", h })]),
                h.span([h.Class("files__dirlabel")], [node.name]),
              ],
            ),
            ...(open ? [fileRows({ nodes: node.children, finding, viewed, collapsed, state, h })] : []),
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

/**
 * The file a finding shows in its code panel: a related file the reviewer picked, or the finding's own.
 */
const viewedFileOf = ({ model, finding }: { readonly model: Model; readonly finding: ReviewFindingPayload }): string =>
  model.viewedFile?.findingId === finding.id && finding.relatedFiles.includes(model.viewedFile.file)
    ? model.viewedFile.file
    : finding.file;

/**
 * True when the finding names files beyond its own, so the files pane has something to show.
 */
const hasRelatedFiles = (finding: ReviewFindingPayload | undefined): finding is ReviewFindingPayload =>
  finding !== undefined && finding.relatedFiles.length > 1;

/**
 * The right-docked tree of the files to review with the selected finding.
 */
export const filesPane = ({
  state,
  model,
  derived,
  h,
}: {
  readonly state: ReviewStatePayload;
  readonly model: Model;
  readonly derived: ReviewDerivation;
  readonly h: HtmlBuilder<Message>;
}): Html | null => {
  const finding = derived.selected;
  if (!hasRelatedFiles(finding)) return null;
  const tree = fileTree(finding.relatedFiles);
  const directories = directoryPaths(tree);
  const allCollapsed = directories.every((path) => model.collapsedDirectories.includes(path));
  return h.aside(
    [h.Class("files"), h.AriaLabel("Files to review together")],
    [
      h.div(
        [h.Class("files__head")],
        [
          h.h2(
            [h.Class("files__title")],
            [h.span([], ["Review together"]), h.span([h.Class("files__count")], [String(finding.relatedFiles.length)])],
          ),
          ...(directories.length === 0
            ? []
            : [
                iconButton({
                  label: allCollapsed ? "Expand all folders" : "Collapse all folders",
                  attributes: [
                    h.OnClick(Message.SetAllFileDirectories({ collapsed: !allCollapsed })),
                    h.Class("icon-btn files__fold"),
                  ],
                  name: allCollapsed ? "expand" : "collapse",
                  h,
                  keys: [model.modKey, allCollapsed ? "→" : "←"],
                }),
              ]),
        ],
      ),
      h.div(
        [h.Class("files__scroll")],
        [
          fileRows({
            nodes: tree,
            finding,
            viewed: viewedFileOf({ model, finding }),
            collapsed: model.collapsedDirectories,
            state,
            h,
          }),
        ],
      ),
    ],
  );
};

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
}): Html => {
  const name = actorLabel(actor);
  const mark = agentMarkFor(name);
  return h.span(
    [h.Class("actor"), h.Title(actor)],
    [
      mark === null ? icon({ name: actorKind(actor) === "agent" ? "sparkle" : "user", h }) : agentMarkIcon({ mark, h }),
      h.span([h.Class("actor__name")], [mark === null ? name : agentLabel(mark)]),
      h.span(
        [h.Class("actor__verb")],
        [
          ...(verb === "" ? [] : [`${verb} `]),
          h.time([h.Datetime(at), h.Title(at)], [relativeTime({ iso: at, nowIso })]),
        ],
      ),
    ],
  );
};

/**
 * What to verify before deciding: the rule's checklist, or its standard when it has none. Who may decide is the
 * authority badge, and where the finding stands is the decision row, so neither repeats here.
 */
const criteriaRow = ({
  finding,
  state,
  h,
}: {
  readonly finding: ReviewFindingPayload;
  readonly state: ReviewStatePayload;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const criteria = finding.guidance.checks.length > 0 ? finding.guidance.checks : [finding.guidance.standard];
  return h.div(
    [h.Class("brief__row")],
    [
      h.h2([h.Class("brief__aside brief__label")], [state.mode === "calibration" ? "Applies if" : "Accept if"]),
      h.ul(
        [h.Class("brief__body brief__criteria")],
        criteria.map((criterion) =>
          h.li([], [h.span([h.Class("brief__tick")], [icon({ name: "check", h })]), h.span([], [criterion])]),
        ),
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

/**
 * The agent's proposal: who and when on one line, then its labelled lines.
 */
const proposalRow = ({
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
  return h.div(
    [h.Class("brief__row")],
    [
      h.div(
        [h.Class("brief__aside")],
        // The row is the proposal, so its heading needs only who and when.
        [actorRow({ actor: proposal.actor, at: proposal.at, nowIso: state.generatedAt, verb: "", h })],
      ),
      h.div(
        [h.Class("brief__body")],
        [
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
      ),
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
  return h.details(
    [
      h.Class("guidance"),
      h.Open(model.guidanceFindingIds.includes(finding.id)),
      h.OnToggle((isOpen) => Message.SetFindingGuidance({ findingId: finding.id, open: isOpen })),
    ],
    [
      h.summary(
        [
          h.Class("guidance__summary"),
          h.OnClick(
            Message.SetFindingGuidance({ findingId: finding.id, open: !model.guidanceFindingIds.includes(finding.id) }),
          ),
        ],
        [
          h.span([h.Class("guidance__chevron")], [icon({ name: "chevron", h })]),
          h.span([], ["Details"]),
          ...kbd({ keys: ["G"], h }),
          h.code([], [finding.ruleId]),
        ],
      ),
      h.div(
        [h.Class("guidance__body")],
        [
          ...(model.screen._tag !== "Reviewing" ? [] : [criteriaRow({ finding, state: model.screen.state, h })]),
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
  const { previous, next } = findingNeighbours(derived);
  const canOpen = finding.editor !== null && state.applications.length > 0;
  const preferred = state.applications.find(({ id }) => id === model.preferredApplication);
  return h.div(
    [h.Class("detail__bar")],
    [
      h.span(
        [h.Class("detail__position")],
        [derived.selectedIndex < 0 ? "Decision saved" : `${derived.selectedIndex + 1} / ${derived.visible.length}`],
      ),
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
      ...(hasRelatedFiles(finding)
        ? [
            iconButton({
              label: model.filesOpen ? "Hide files" : "Show files",
              attributes: [
                h.OnClick(Message.ToggledFiles()),
                h.AriaPressed(model.filesOpen ? "true" : "false"),
                h.Class(`icon-btn files-toggle files-toggle--docked${model.filesOpen ? " icon-btn--active" : ""}`),
              ],
              name: "panelRight",
              h,
              keys: ["]"],
            }),
            iconButton({
              label: model.filesSheetOpen ? "Hide files" : "Show files",
              attributes: [
                h.OnClick(Message.ToggledFilesSheet()),
                h.AriaPressed(model.filesSheetOpen ? "true" : "false"),
                h.Class(`icon-btn files-toggle files-toggle--sheet${model.filesSheetOpen ? " icon-btn--active" : ""}`),
              ],
              name: "panelRight",
              h,
            }),
          ]
        : []),
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

const inlineFinding = ({
  finding,
  state,
  model,
  derived,
  h,
}: {
  readonly finding: ReviewFindingPayload;
  readonly state: ReviewStatePayload;
  readonly model: Model;
  readonly derived: ReviewDerivation;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const status = statusFor({ derived, finding });
  const hidden = independentHidden({ model, findingId: finding.id });
  const closed =
    state.mode === "review" && !hidden && status !== "unresolved" && !model.editingDecisionIds.includes(finding.id);
  const proposal = hidden ? null : proposalRow({ finding, state, h });
  const acceptance = hidden ? null : acceptanceCard({ finding, state, h });
  return h.keyed("section")(
    finding.id,
    [
      h.Id(`finding-${finding.id}`),
      h.OnFocusEnter(Message.FocusedFinding({ findingId: finding.id })),
      h.OnClick(Message.FocusedFinding({ findingId: finding.id })),
      h.Class(`inline-finding${derived.selected?.id === finding.id ? " inline-finding--selected" : ""}`),
      h.AriaLabel(`${finding.ruleTitle} at line ${finding.line}`),
    ],
    [
      h.div(
        [h.Class("inline-finding__head")],
        [
          h.h2([h.Class("inline-finding__title"), h.Tabindex(-1)], [finding.ruleTitle]),
          h.span([h.Class("badge")], [lifecycleLabel(finding.lifecycle)]),
          ...(finding.authority === "human"
            ? [h.span([h.Class("badge badge--human")], [icon({ name: "user", h }), "Human decision"])]
            : []),
          ...(closed
            ? [
                h.span(
                  [h.Class(`decision__status decision__status--${status}`)],
                  [
                    icon({ name: status === "accepted" ? "check" : "x", h }),
                    status === "accepted" ? "Accepted" : "Changes requested",
                  ],
                ),
                button({
                  label: "Edit decision",
                  message: Message.EditedDecision({ findingId: finding.id }),
                  variant: "secondary",
                  h,
                  options: { size: "sm" },
                }),
              ]
            : []),
        ],
      ),
      ...(closed
        ? []
        : [
            ...(proposal === null ? [h.p([h.Class("inline-finding__message")], [finding.message])] : [proposal]),
            decisionForm({ state, finding, model, derived, h }),
            guidance({ finding, model, h }),
            ...(acceptance === null ? [] : [acceptance]),
            ...(hidden || finding.lineageReason === null
              ? []
              : [lineageCard({ reason: finding.lineageReason, invalidationReasons: finding.invalidationReasons, h })]),
            ...(model.independentReview && !hidden
              ? [h.p([h.Class("card__text")], ["Independent assessment: ", model.independentNotes[finding.id] ?? ""])]
              : []),
          ]),
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
  if (finding === undefined) return h.main([h.Class("detail detail--empty")], [h.p([], ["Select a finding."])]);
  const viewed = viewedFileOf({ model, finding });
  const ids = new Set([...derived.visible.map(({ id }) => id), ...model.retainedFindingIds]);
  const findings = state.findings
    .filter((item) => item.file === viewed && ids.has(item.id))
    .toSorted((a, b) => a.line - b.line || a.column - b.column);
  return h.main(
    [h.Class("detail")],
    [
      detailBar({ state, finding, model, derived, h }),
      h.div(
        [h.Class("detail__body")],
        [
          ...(viewed === finding.file ? [] : [inlineFinding({ finding, state, model, derived, h })]),
          fileCode({
            file: viewed,
            source: state.sources[viewed] ?? "",
            change: state.changes[viewed],
            findings,
            model,
            card: (item) => inlineFinding({ finding: item, state, model, derived, h }),
            h,
          }),
        ],
      ),
    ],
  );
};
