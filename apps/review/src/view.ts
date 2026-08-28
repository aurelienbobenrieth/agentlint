import { Option } from "effect";
import type { Document, Html, HtmlBuilder } from "foldkit/html";

import {
  ClearedFacets,
  ClickedAccept,
  ClickedCopyFindingContext,
  ClickedCopyInstructions,
  ClickedDismissToast,
  ClickedDownloadAcceptances,
  ClickedFinish,
  ClickedOpenFinding,
  ClickedRequestChanges,
  ClickedSaveCalibration,
  ClickedWithdraw,
  HoveredToasts,
  LeftToasts,
  SelectedCalibration,
  SelectedCodeView,
  SelectedEditorApplication,
  SelectedFinding,
  SelectedGroupBy,
  SelectedView,
  SetGuidanceOpen,
  StartedSidebarResize,
  ToggledAuthorityFacet,
  ToggledLifecycleFacet,
  ToggledHelp,
  ToggledRuleFacet,
  ToggledSidebar,
  ToggledStatusFacet,
  UpdatedNote,
  UpdatedQuery,
  UpdatedReason,
  type Message,
} from "./message";
import { emptyDraft, type AuthorityFacet, type LifecycleFacet, type Model, type StatusFacet, type View } from "./model";
import { effectiveFindingStatus, facetCount, inView, selectedFinding, statusFacet } from "./selection";
import { highlightedLine } from "./syntax";
import type { EditorApplicationId, ReviewFindingPayload, ReviewStatePayload } from "./types";

type IconName =
  | "arrow"
  | "book"
  | "check"
  | "chevron"
  | "code"
  | "copy"
  | "external"
  | "file"
  | "filter"
  | "folder"
  | "panel"
  | "search"
  | "keyboard"
  | "sparkle"
  | "user"
  | "x";

type AbsoluteSvgPath = `M${string}`;

const iconPaths: Record<IconName, ReadonlyArray<AbsoluteSvgPath>> = {
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  book: [
    "M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z",
    "M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z",
  ],
  check: ["M5 12l4 4L19 6"],
  chevron: ["M8 10l4 4 4-4"],
  code: ["M8 9l-3 3 3 3", "M16 9l3 3-3 3"],
  copy: ["M8 8h11v11H8z", "M5 16H4V5h11v1"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v5h5"],
  filter: ["M4 6h16", "M7 12h10", "M10 18h4"],
  folder: ["M3 6h7l2 2h9v11H3z"],
  panel: ["M4 4h16v16H4z", "M9 4v16"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16", "M21 21l-4.3-4.3"],
  keyboard: ["M3 7h18v11H3z", "M7 11h.01", "M11 11h.01", "M15 11h.01", "M8 15h8"],
  sparkle: [
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    "M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z",
  ],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M4 21a8 8 0 0 1 16 0"],
  x: ["M6 6l12 12", "M18 6 6 18"],
};

/** Filled brand marks (Simple Icons paths) for detected applications. */
const brandPaths: Record<Exclude<EditorApplicationId, "explorer">, string> = {
  cursor:
    "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23",
  vscode:
    "M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z",
  "vscode-insiders":
    "M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z",
  zed: "M2.25 1.5a.75.75 0 0 0-.75.75v16.5H0V2.25A2.25 2.25 0 0 1 2.25 0h20.095c1.002 0 1.504 1.212.795 1.92L10.764 14.298h3.486V12.75h1.5v1.922a1.125 1.125 0 0 1-1.125 1.125H9.264l-2.578 2.578h11.689V9h1.5v9.375a1.5 1.5 0 0 1-1.5 1.5H5.185L2.562 22.5H21.75a.75.75 0 0 0 .75-.75V5.25H24v16.5A2.25 2.25 0 0 1 21.75 24H1.655C.653 24 .151 22.788.86 22.08L13.19 9.75H9.75v1.5h-1.5V9.375A1.125 1.125 0 0 1 9.375 8.25h5.314l2.625-2.625H5.625V15h-1.5V5.625a1.5 1.5 0 0 1 1.5-1.5h13.19L21.438 1.5z",
};

const appIcon = (application: EditorApplicationId, h: HtmlBuilder<Message>): Html =>
  application === "explorer"
    ? icon("folder", h)
    : h.svg(
        [
          h.ViewBox("0 0 24 24"),
          h.Width("16"),
          h.Height("16"),
          h.Fill("currentColor"),
          h.AriaHidden(true),
          h.Class(`icon icon--brand icon--${application}`),
        ],
        [h.path([h.D(brandPaths[application])], [])],
      );

const icon = (name: IconName, h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.ViewBox("0 0 24 24"),
      h.Width("16"),
      h.Height("16"),
      h.Fill("none"),
      h.Stroke("currentColor"),
      h.StrokeWidth("1.6"),
      h.StrokeLinecap("round"),
      h.StrokeLinejoin("round"),
      h.AriaHidden(true),
      h.Class("icon"),
    ],
    iconPaths[name].map((path) => h.path([h.D(path)], [])),
  );

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const button = (
  label: string,
  message: Message,
  variant: ButtonVariant,
  h: HtmlBuilder<Message>,
  options: { disabled?: boolean; icon?: IconName; size?: "sm" | "md" } = {},
): Html =>
  h.button(
    [
      h.Type("button"),
      h.OnClick(message),
      h.Disabled(options.disabled ?? false),
      h.Class(`btn btn--${variant}${options.size === "sm" ? " btn--sm" : ""}`),
    ],
    [...(options.icon === undefined ? [] : [icon(options.icon, h)]), h.span([], [label])],
  );

const kbd = (keys: ReadonlyArray<string>, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  keys.map((key) => h.kbd([h.Class("kbd")], [key]));

/** Linear-style tooltip: label plus the shortcut caps, shown on hover and focus. */
const tip = (label: string, keys: ReadonlyArray<string>, trigger: Html, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class("tip")],
    [trigger, h.span([h.Class("tip__bubble"), h.Role("tooltip")], [h.span([], [label]), ...kbd(keys, h)])],
  );

const iconButton = (
  label: string,
  attributes: ReadonlyArray<Parameters<HtmlBuilder<Message>["button"]>[0][number]>,
  name: IconName,
  h: HtmlBuilder<Message>,
  keys: ReadonlyArray<string> = [],
): Html =>
  tip(
    label,
    keys,
    h.button([h.Type("button"), h.Class("icon-btn"), h.AriaLabel(label), ...attributes], [icon(name, h)]),
    h,
  );

// Labels ---------------------------------------------------------------------

const statusLabel = (status: StatusFacet, mode: ReviewStatePayload["mode"]): string =>
  status === "accepted"
    ? mode === "calibration"
      ? "Labeled"
      : "Accepted"
    : status === "changes_requested"
      ? "Changes requested"
      : "Open";

const lifecycleLabel = (lifecycle: LifecycleFacet): string =>
  lifecycle === "change" ? "Introduced by this change" : "Current code";

const authorityLabel = (authority: AuthorityFacet): string =>
  authority === "human" ? "Human decision" : "Agent may decide";

const relativeTime = (iso: string, nowIso: string): string => {
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return iso;
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const safeExternalHref = (href: string | null): string | null => {
  if (href === null) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

const actorLabel = (actor: string): string => actor.replace(/^(agent|human):/u, "");
const actorKind = (actor: string): "agent" | "human" => (actor.startsWith("agent") ? "agent" : "human");

// Sidebar ----------------------------------------------------------------------

const statusDot = (status: StatusFacet, authority: ReviewFindingPayload["authority"], h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class(`dot dot--${status === "open" && authority === "human" ? "human" : status}`), h.AriaHidden(true)],
    [],
  );

const findingRow = (
  finding: ReviewFindingPayload,
  state: ReviewStatePayload,
  model: Model,
  selectedId: string | null,
  h: HtmlBuilder<Message>,
): Html => {
  const selected = selectedId === finding.id;
  const status = statusFacet(effectiveFindingStatus(finding, state, model));
  const trailing = model.view === "decisions" ? (finding.acceptance?.at ?? null) : null;
  return h.button(
    [
      h.Type("button"),
      h.OnClick(SelectedFinding({ findingId: finding.id })),
      h.Class(`row${selected ? " row--selected" : ""}`),
      ...(selected ? [h.AriaCurrent("true")] : []),
    ],
    [
      statusDot(status, finding.authority, h),
      h.span(
        [h.Class("row__body")],
        [
          h.span([h.Class("row__title")], [finding.message]),
          h.span(
            [h.Class("row__meta")],
            [model.groupBy === "rule" && model.view === "queue" ? finding.file : finding.ruleTitle],
          ),
        ],
      ),
      h.span(
        [h.Class("row__trailing")],
        [trailing === null ? `L${finding.line}` : relativeTime(trailing, state.generatedAt)],
      ),
    ],
  );
};

const groupList = (
  state: ReviewStatePayload,
  model: Model,
  visible: ReadonlyArray<ReviewFindingPayload>,
  selectedId: string | null,
  h: HtmlBuilder<Message>,
): Html => {
  if (visible.length === 0) {
    const filtered = model.query.trim().length > 0 || facetCount(model) > 0;
    return h.div(
      [h.Class("empty")],
      [
        h.div([h.Class("empty__mark")], [icon("check", h)]),
        h.p(
          [],
          [
            filtered
              ? "Nothing matches these filters."
              : model.view === "decisions"
                ? "No accepted findings yet."
                : "Nothing left to decide.",
          ],
        ),
        ...(filtered ? [button("Clear filters", ClearedFacets(), "ghost", h, { size: "sm" })] : []),
      ],
    );
  }
  const byRule = model.groupBy === "rule" && model.view === "queue";
  const keyOf = (finding: ReviewFindingPayload) => (byRule ? finding.ruleId : finding.file);
  const keys = [...new Set(visible.map(keyOf))];
  return h.div(
    [h.Class("list"), h.Role("list")],
    keys.map((key) => {
      const findings = visible.filter((finding) => keyOf(finding) === key);
      const first = findings[0];
      return h.section(
        [h.Class("group")],
        [
          h.div(
            [h.Class("group__head")],
            [
              h.span([h.Class("group__title")], [byRule ? (first?.ruleTitle ?? key) : key]),
              h.span([h.Class("group__count")], [String(findings.length)]),
            ],
          ),
          ...findings.map((finding) => findingRow(finding, state, model, selectedId, h)),
        ],
      );
    }),
  );
};

const facetOption = (label: string, active: boolean, message: Message, h: HtmlBuilder<Message>, count?: number): Html =>
  h.button(
    [
      h.Type("button"),
      h.OnClick(message),
      h.Class(`facet${active ? " facet--active" : ""}`),
      h.AriaPressed(active ? "true" : "false"),
    ],
    [
      h.span([h.Class("facet__box")], [icon("check", h)]),
      h.span([h.Class("facet__label")], [label]),
      ...(count === undefined ? [] : [h.span([h.Class("facet__count")], [String(count)])]),
    ],
  );

const filterPopover = (state: ReviewStatePayload, model: Model, h: HtmlBuilder<Message>): Html => {
  const rules = [...new Map(state.findings.map((finding) => [finding.ruleId, finding.ruleTitle])).entries()].toSorted(
    ([left], [right]) => left.localeCompare(right),
  );
  const countStatus = (status: StatusFacet) =>
    state.findings.filter(
      (finding) =>
        inView(finding, model.view, state, model) &&
        statusFacet(effectiveFindingStatus(finding, state, model)) === status,
    ).length;
  const countAuthority = (authority: AuthorityFacet) =>
    state.findings.filter((finding) => inView(finding, model.view, state, model) && finding.authority === authority)
      .length;
  const countRule = (ruleId: string) =>
    state.findings.filter((finding) => inView(finding, model.view, state, model) && finding.ruleId === ruleId).length;
  const statuses: ReadonlyArray<StatusFacet> = model.view === "decisions" ? [] : ["open", "changes_requested"];
  return h.div(
    [h.Id("filter-menu"), h.Class("popover popover--filters"), h.Popover("auto")],
    [
      ...(statuses.length === 0
        ? []
        : [
            h.div(
              [h.Class("popover__section")],
              [
                h.span([h.Class("popover__label")], ["Status"]),
                ...statuses.map((status) =>
                  facetOption(
                    statusLabel(status, state.mode),
                    model.facets.statuses.includes(status),
                    ToggledStatusFacet({ status }),
                    h,
                    countStatus(status),
                  ),
                ),
              ],
            ),
          ]),
      h.div(
        [h.Class("popover__section")],
        [
          h.span([h.Class("popover__label")], ["Authority"]),
          ...(["human", "agent"] as const).map((authority) =>
            facetOption(
              authorityLabel(authority),
              model.facets.authorities.includes(authority),
              ToggledAuthorityFacet({ authority }),
              h,
              countAuthority(authority),
            ),
          ),
        ],
      ),
      h.div(
        [h.Class("popover__section")],
        [
          h.span([h.Class("popover__label")], ["Origin"]),
          ...(["change", "state"] as const).map((lifecycle) =>
            facetOption(
              lifecycleLabel(lifecycle),
              model.facets.lifecycles.includes(lifecycle),
              ToggledLifecycleFacet({ lifecycle }),
              h,
              state.findings.filter(
                (finding) => inView(finding, model.view, state, model) && finding.lifecycle === lifecycle,
              ).length,
            ),
          ),
        ],
      ),
      h.div(
        [h.Class("popover__section popover__section--scroll")],
        [
          h.span([h.Class("popover__label")], ["Rule"]),
          ...rules.map(([ruleId, title]) =>
            facetOption(
              title,
              model.facets.ruleIds.includes(ruleId),
              ToggledRuleFacet({ ruleId }),
              h,
              countRule(ruleId),
            ),
          ),
        ],
      ),
      ...(model.view === "decisions"
        ? []
        : [
            h.div(
              [h.Class("popover__section popover__section--row")],
              [
                h.span([h.Class("popover__label")], ["Group by"]),
                h.div(
                  [h.Class("segment segment--sm")],
                  (["file", "rule"] as const).map((groupBy) =>
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(SelectedGroupBy({ groupBy })),
                        h.Class(`segment__item${model.groupBy === groupBy ? " segment__item--active" : ""}`),
                        h.AriaPressed(model.groupBy === groupBy ? "true" : "false"),
                      ],
                      [groupBy === "file" ? "File" : "Rule"],
                    ),
                  ),
                ),
              ],
            ),
          ]),
    ],
  );
};

const chip = (label: string, message: Message, h: HtmlBuilder<Message>): Html =>
  h.button(
    [h.Type("button"), h.OnClick(message), h.Class("chip"), h.AriaLabel(`Remove filter ${label}`)],
    [h.span([], [label]), icon("x", h)],
  );

const activeChips = (state: ReviewStatePayload, model: Model, h: HtmlBuilder<Message>): Html | null => {
  if (facetCount(model) === 0) return null;
  const titles = new Map(state.findings.map((finding) => [finding.ruleId, finding.ruleTitle]));
  return h.div(
    [h.Class("chips")],
    [
      ...model.facets.statuses.map((status) =>
        chip(statusLabel(status, state.mode), ToggledStatusFacet({ status }), h),
      ),
      ...model.facets.authorities.map((authority) =>
        chip(authority === "human" ? "Human" : "Agent", ToggledAuthorityFacet({ authority }), h),
      ),
      ...model.facets.lifecycles.map((lifecycle) =>
        chip(lifecycle === "change" ? "This change" : "Current code", ToggledLifecycleFacet({ lifecycle }), h),
      ),
      ...model.facets.ruleIds.map((ruleId) => chip(titles.get(ruleId) ?? ruleId, ToggledRuleFacet({ ruleId }), h)),
      h.button([h.Type("button"), h.OnClick(ClearedFacets()), h.Class("chips__clear")], ["Clear"]),
    ],
  );
};

const sidebar = (
  state: ReviewStatePayload,
  model: Model,
  visible: ReadonlyArray<ReviewFindingPayload>,
  selectedId: string | null,
  h: HtmlBuilder<Message>,
): Html => {
  const queueCount = state.findings.filter((finding) => inView(finding, "queue", state, model)).length;
  const decisionsCount = state.findings.length - queueCount;
  const tab = (view: View, label: string, count: number, key: string) =>
    tip(
      label,
      [key],
      h.button(
        [
          h.Type("button"),
          h.OnClick(SelectedView({ view })),
          h.Class(`tab${model.view === view ? " tab--active" : ""}`),
          h.AriaPressed(model.view === view ? "true" : "false"),
        ],
        [h.span([], [label]), h.span([h.Class("tab__count")], [String(count)])],
      ),
      h,
    );
  const chips = activeChips(state, model, h);
  return h.aside(
    [h.Class("sidebar")],
    [
      h.div(
        [h.Class("tabs")],
        [tab("queue", "Queue", queueCount, "1"), tab("decisions", "Decisions", decisionsCount, "2")],
      ),
      h.div(
        [h.Class("search")],
        [
          icon("search", h),
          h.input([
            h.Type("search"),
            h.Class("search__input"),
            h.Value(model.query),
            h.Placeholder("Search"),
            h.AriaLabel("Search findings"),
            h.OnInput((value) => UpdatedQuery({ value })),
          ]),
          ...(model.query.length === 0
            ? []
            : [
                iconButton(
                  "Clear search",
                  [h.OnClick(UpdatedQuery({ value: "" })), h.Class("icon-btn icon-btn--inline")],
                  "x",
                  h,
                ),
              ]),
          tip(
            "Filters",
            ["F"],
            h.button(
              [
                h.Type("button"),
                h.Class(`icon-btn icon-btn--inline${facetCount(model) > 0 ? " icon-btn--marked" : ""}`),
                h.AriaLabel("Filters"),
                h.AriaHasPopup("dialog"),
                h.AriaControls("filter-menu"),
                h.Popovertarget("filter-menu"),
              ],
              [icon("filter", h)],
            ),
            h,
          ),
          filterPopover(state, model, h),
        ],
      ),
      ...(chips === null ? [] : [chips]),
      groupList(state, model, visible, selectedId, h),
    ],
  );
};

// Detail -----------------------------------------------------------------------

const codePanel = (
  state: ReviewStatePayload,
  finding: ReviewFindingPayload,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const allLines = finding.code.source.split(/\r?\n/u);
  const start = Math.max(1, finding.code.focus.startLine);
  const end = Math.max(start, finding.code.focus.endLine);
  const first = model.codeView === "full" ? 1 : Math.max(1, start - 3);
  const last = model.codeView === "full" ? allLines.length : Math.min(allLines.length, end + 3);
  const lines = allLines.slice(first - 1, last);
  const canOpen = finding.editor !== null && state.applications.length > 0;
  const preferred = state.applications.find(({ id }) => id === model.preferredApplication);
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
                    : [h.OnClick(ClickedOpenFinding({ findingId: finding.id }))]),
                  h.Title(preferred === undefined ? "Open in…" : `Open in ${preferred.label}`),
                ],
                [icon("file", h), h.span([], [`${finding.file}:${finding.line}`]), icon("external", h)],
              )
            : h.span([h.Class("code__file")], [icon("file", h), h.span([], [`${finding.file}:${finding.line}`])]),
          h.button(
            [
              h.Type("button"),
              h.Class("code__toggle"),
              h.OnClick(SelectedCodeView({ codeView: model.codeView === "full" ? "focused" : "full" })),
            ],
            [model.codeView === "full" ? "Focus" : `Full file · ${allLines.length} lines`],
          ),
        ],
      ),
      h.pre(
        [h.Class("code__lines")],
        lines.map((line, index) => {
          const number = first + index;
          const focused = number >= start && number <= end;
          return h.code(
            [h.Class(`line${focused ? " line--focus" : ""}`)],
            [
              h.span([h.Class("line__n")], [String(number)]),
              h.span([h.Class("line__c"), h.InnerHTML(highlightedLine(line, finding.file))], []),
            ],
          );
        }),
      ),
    ],
  );
};

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

const decisionForm = (
  state: ReviewStatePayload,
  finding: ReviewFindingPayload,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const draft = model.drafts[finding.id] ?? emptyDraft();
  const busy = model.busyFindingId === finding.id;
  const status = effectiveFindingStatus(finding, state, model);
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
                h.OnClick(SelectedCalibration({ findingId: finding.id, calibration: value })),
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
          h.OnInput((value) => UpdatedNote({ findingId: finding.id, value })),
          h.Placeholder("Note for the rule author (optional)"),
          h.AriaLabel("Calibration note"),
          h.Rows(2),
        ]),
        h.div(
          [h.Class("decision__actions")],
          [
            button(busy ? "Saving…" : "Save label", ClickedSaveCalibration({ findingId: finding.id }), "primary", h, {
              disabled: busy || draft.calibration === "unreviewed",
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
        h.textarea([
          h.Id(reasonId),
          h.Class("textarea"),
          h.Value(draft.reason),
          h.OnInput((value) => UpdatedReason({ findingId: finding.id, value })),
          h.Placeholder("What should change?"),
          h.AriaLabel("Requested correction"),
          h.Rows(2),
        ]),
        h.div(
          [h.Class("decision__actions")],
          [
            button("Request correction", ClickedRequestChanges({ findingId: finding.id }), "danger", h, {
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
      : finding.proposal?.diff == null
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
        h.OnInput((value) => UpdatedReason({ findingId: finding.id, value })),
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
            button(acceptLabel, ClickedAccept({ findingId: finding.id }), "primary", h, { disabled: busy || empty }),
            h,
          ),
          tip(
            "Request changes",
            ["R"],
            button(changesLabel, ClickedRequestChanges({ findingId: finding.id }), "danger", h, {
              disabled: busy,
            }),
            h,
          ),
          ...(status === "accepted" || status === "changes_requested"
            ? [
                h.span(
                  [h.Class(`decision__status decision__status--${status}`)],
                  [
                    icon(status === "accepted" ? "check" : "x", h),
                    statusLabel(status, state.mode),
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(ClickedWithdraw({ findingId: finding.id })),
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

const guidance = (finding: ReviewFindingPayload, model: Model, h: HtmlBuilder<Message>): Html => {
  const { checks, examples, references } = finding.guidance;
  const hasBody = checks.length > 0 || examples.length > 0 || references.length > 0;
  if (!hasBody) return h.span([], []);
  return h.details(
    [h.Class("guidance"), h.Open(model.guidanceOpen), h.OnToggle((isOpen) => SetGuidanceOpen({ open: isOpen }))],
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
                        example.code
                          .split(/\r?\n/u)
                          .map((line) =>
                            h.code([h.Class("example__line"), h.InnerHTML(highlightedLine(line, finding.file))], []),
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
            h.OnClick(SelectedEditorApplication({ findingId: finding.id, application: application.id })),
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

const detail = (
  state: ReviewStatePayload,
  finding: ReviewFindingPayload | undefined,
  previous: ReviewFindingPayload | undefined,
  next: ReviewFindingPayload | undefined,
  position: number,
  total: number,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  if (finding === undefined) {
    return h.main([h.Class("detail detail--empty")], [h.p([], ["Select a finding."])]);
  }
  const status = effectiveFindingStatus(finding, state, model);
  const canOpen = finding.editor !== null && state.applications.length > 0;
  const preferred = state.applications.find(({ id }) => id === model.preferredApplication);
  const proposal = proposalCard(finding, state, h);
  const acceptance = status === "accepted" || finding.acceptance !== null ? acceptanceCard(finding, state, h) : null;
  return h.main(
    [h.Class("detail")],
    [
      h.div(
        [h.Class("detail__bar")],
        [
          h.span([h.Class("detail__position")], [`${position} / ${total}`]),
          h.div(
            [h.Class("detail__nav")],
            [
              iconButton(
                "Previous",
                [
                  h.Disabled(previous === undefined),
                  ...(previous === undefined ? [] : [h.OnClick(SelectedFinding({ findingId: previous.id }))]),
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
                  ...(next === undefined ? [] : [h.OnClick(SelectedFinding({ findingId: next.id }))]),
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
                            : [h.OnClick(ClickedOpenFinding({ findingId: finding.id }))]),
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
            button("Copy context", ClickedCopyFindingContext({ findingId: finding.id }), "secondary", h, {
              icon: "copy",
              size: "sm",
            }),
            h,
          ),
        ],
      ),
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
      codePanel(state, finding, model, h),
      ...(proposal === null ? [] : [proposal]),
      ...(acceptance === null ? [] : [acceptance]),
      ...(finding.lineageReason === null
        ? []
        : [
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
                h.p([h.Class("card__text")], [finding.lineageReason]),
              ],
            ),
          ]),
      decisionForm(state, finding, model, h),
      guidance(finding, model, h),
    ],
  );
};

// Shell ------------------------------------------------------------------------

const toasts = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class("toasts"),
      h.AriaLive("Polite"),
      h.AriaAtomic(false),
      h.OnMouseEnter(HoveredToasts()),
      h.OnMouseLeave(LeftToasts()),
    ],
    model.toasts.map((toast) =>
      h.div(
        [h.Class(`toast toast--${toast.tone} toast--${toast.phase}`)],
        [
          h.span([h.Class("toast__icon")], [icon(toast.tone === "danger" ? "x" : "check", h)]),
          h.p([], [toast.message]),
          iconButton(
            "Dismiss",
            [h.OnClick(ClickedDismissToast({ id: toast.id })), h.Class("icon-btn icon-btn--inline")],
            "x",
            h,
            ["X"],
          ),
        ],
      ),
    ),
  );

const reviewView = (state: ReviewStatePayload, model: Model, h: HtmlBuilder<Message>): Html => {
  const { visible, selected } = selectedFinding(state, model);
  const selectedIndex = selected === undefined ? -1 : visible.findIndex(({ id }) => id === selected.id);
  const open = state.findings.filter(
    (finding) => effectiveFindingStatus(finding, state, model) === "unresolved",
  ).length;
  return h.div(
    [
      h.Class(`shell${model.sidebarOpen ? "" : " shell--collapsed"}${model.resizingSidebar ? " shell--resizing" : ""}`),
      h.Style({ "--sidebar-w": `${model.sidebarWidth}px` }),
    ],
    [
      h.header(
        [h.Class("topbar")],
        [
          iconButton(model.sidebarOpen ? "Hide list" : "Show list", [h.OnClick(ToggledSidebar())], "panel", h, ["["]),
          h.span([h.Class("brand")], ["agentlint"]),
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
          h.span([h.Class(`gate${open === 0 ? " gate--open" : ""}`)], [open === 0 ? "Gate open" : `${open} to decide`]),
          iconButton("Keyboard shortcuts", [h.OnClick(ToggledHelp())], "keyboard", h, ["?"]),
          button("Finish", ClickedFinish(), "primary", h, {
            size: "sm",
            disabled: open > 0 && state.mode === "review",
          }),
        ],
      ),
      h.div(
        [h.Class("workspace")],
        [
          sidebar(state, model, visible, selected?.id ?? null, h),
          h.div(
            [
              h.Class("resizer"),
              h.Role("separator"),
              h.AriaLabel("Resize list"),
              h.OnPointerDown((_pointerType, pointerButton) =>
                pointerButton === 0 ? Option.some(StartedSidebarResize()) : Option.none(),
              ),
            ],
            [],
          ),
          detail(
            state,
            selected,
            selectedIndex > 0 ? visible[selectedIndex - 1] : undefined,
            selectedIndex >= 0 && selectedIndex < visible.length - 1 ? visible[selectedIndex + 1] : undefined,
            selectedIndex + 1,
            visible.length,
            model,
            h,
          ),
        ],
      ),
      toasts(model, h),
      ...(model.helpOpen ? [helpDialog(model, h)] : []),
    ],
  );
};

const helpDialog = (model: Model, h: HtmlBuilder<Message>): Html => {
  const group = (title: string, rows: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): Html =>
    h.div(
      [h.Class("help__group")],
      [
        h.h3([], [title]),
        ...rows.map(([label, keys]) =>
          h.div([h.Class("help__row")], [h.span([], [label]), h.span([h.Class("help__keys")], kbd(keys, h))]),
        ),
      ],
    );
  return h.div(
    [h.Class("help"), h.Role("dialog"), h.AriaLabel("Keyboard shortcuts")],
    [
      h.div([h.Class("help__backdrop"), h.OnClick(ToggledHelp())], []),
      h.div(
        [h.Class("help__panel")],
        [
          h.div(
            [h.Class("help__head")],
            [h.h2([], ["Keyboard shortcuts"]), iconButton("Close", [h.OnClick(ToggledHelp())], "x", h, ["Esc"])],
          ),
          h.div(
            [h.Class("help__columns")],
            [
              group("Navigate", [
                ["Next finding", ["J"]],
                ["Previous finding", ["K"]],
                ["Queue", ["1"]],
                ["Decisions", ["2"]],
                ["Search", ["/"]],
                ["Filters", ["F"]],
                ["Toggle list", ["["]],
              ]),
              group("Decide", [
                ["Accept", ["A"]],
                ["Accept from field", [model.modKey, "Enter"]],
                ["Request changes", ["R"]],
                ["Request changes from field", ["Shift", model.modKey, "Enter"]],
                ["Open in editor", ["E"]],
                ["Copy context", ["C"]],
                ["Rule guidance", ["G"]],
                ["Dismiss toast", ["X"]],
                ["Close / unfocus", ["Esc"]],
              ]),
            ],
          ),
        ],
      ),
    ],
  );
};

const finishedView = (summary: string, feedback: string, acceptanceOutput: string, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Class("finish")],
    [
      h.div([h.Class("finish__mark")], [icon("check", h)]),
      h.h1([], ["Review complete"]),
      h.p([h.Class("finish__summary")], [summary]),
      ...(feedback.length > 0 ? [h.pre([h.Class("finish__output")], [feedback])] : []),
      h.div(
        [h.Class("finish__actions")],
        [
          ...(feedback.length > 0
            ? [button("Copy for your agent", ClickedCopyInstructions(), "primary", h, { icon: "copy" })]
            : []),
          ...(acceptanceOutput.length > 0
            ? [button("Download acceptances", ClickedDownloadAcceptances(), "secondary", h)]
            : []),
        ],
      ),
    ],
  );

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "agentlint · Review",
  body:
    model.screen._tag === "Loading"
      ? h.main([h.Class("state")], [h.div([h.Class("loader")], []), h.p([], ["Loading review…"])])
      : model.screen._tag === "LoadFailed"
        ? h.main([h.Class("state")], [h.h1([], ["Review unavailable"]), h.p([], [model.screen.message])])
        : model.screen._tag === "Finished"
          ? finishedView(model.screen.summary, model.screen.feedback, model.screen.acceptanceOutput, h)
          : reviewView(model.screen.state, model, h),
});
