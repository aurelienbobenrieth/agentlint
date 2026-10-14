import type { Html, HtmlBuilder } from "foldkit/html";
import type { ReviewChange, ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Model } from "../../shared/model";
import { icon } from "../../shared/ui/icons";
import { highlightedLine, highlightedLines } from "./syntax";
import { codeSegments } from "./code-layout";

/**
 * One file, with each decision attached to the end of its evidence range.
 */
export const fileCode = ({
  file,
  source,
  change,
  findings,
  model,
  card,
  h,
}: {
  readonly file: string;
  readonly source: string;
  readonly change: ReviewChange | undefined;
  readonly findings: ReadonlyArray<ReviewFindingPayload>;
  readonly model: Model;
  readonly card: (finding: ReviewFindingPayload) => Html;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const diff = model.codeView === "focused" && change !== undefined;
  const deleted = change?.status === "deleted";
  const displayedSource =
    diff && deleted
      ? change.hunks
          .flatMap((hunk) => hunk.lines.filter((line) => line.kind === "deletion").map((line) => line.content))
          .join("\n")
      : source;
  const allLines = highlightedLines({ source: displayedSource, file });
  const additions = new Set<number>();
  const deletions = new Map<number, { number: number; markup: string }[]>();
  for (const hunk of change?.hunks ?? []) {
    let current = hunk.newStart;
    let old = hunk.oldStart;
    for (const line of hunk.lines) {
      if (line.kind === "deletion") {
        const at = Math.max(1, current);
        const rows = deletions.get(at) ?? [];
        rows.push({ number: old++, markup: highlightedLine({ source: line.content, file }) });
        deletions.set(at, rows);
      } else {
        if (line.kind === "addition") additions.add(current);
        else old++;
        current++;
      }
    }
  }
  const ranges = [
    ...findings.flatMap(({ code }) =>
      code.focus === null ? [] : [{ start: code.focus.startLine, end: code.focus.endLine }],
    ),
    // Keep hunk boundaries visible without forcing a whole added file open.
    ...(diff ? change.hunks : []).flatMap((hunk) => {
      const start = Math.max(1, hunk.newStart);
      const end = Math.max(start, hunk.newStart + hunk.lines.filter((line) => line.kind !== "deletion").length - 1);
      return [
        { start, end: start },
        { start: end, end },
      ];
    }),
  ];
  const expanded = (model.expandedCode[`${file}:all`] ?? 0) > 0;
  const segments = codeSegments({ length: allLines.length, ranges });
  const collapsible = segments.some((segment) => segment.kind === "gap");
  const anchors = new Map<number, ReviewFindingPayload[]>();
  for (const finding of findings) {
    const line = finding.code.focus === null ? 0 : Math.max(1, Math.min(allLines.length, finding.code.focus.endLine));
    anchors.set(line, [...(anchors.get(line) ?? []), finding]);
  }
  const renderLine = ({
    number,
    markup,
    kind,
  }: {
    number: number;
    markup: string;
    kind: "context" | "addition" | "deletion";
  }): Html => {
    const focused =
      kind !== "deletion" &&
      findings.some(
        ({ code }) => code.focus !== null && number >= code.focus.startLine && number <= code.focus.endLine,
      );
    return h.keyed("code")(
      `${kind}:${number}`,
      [h.Class(`line line--${kind}${focused ? " line--focus" : ""}`)],
      [
        h.span([h.Class("line__n")], [String(number)]),
        h.keyed("span")("source", [h.Class("line__c"), h.InnerHTML(markup)], []),
      ],
    );
  };
  const lines = (start: number, end: number): Html[] =>
    Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => {
      const number = start + offset;
      return [
        ...(diff && !deleted ? (deletions.get(number) ?? []) : []).map((row) =>
          renderLine({ ...row, kind: "deletion" }),
        ),
        renderLine({
          number,
          markup: allLines[number - 1] ?? " ",
          kind: diff && deleted ? "deletion" : diff && additions.has(number) ? "addition" : "context",
        }),
        ...(anchors.get(number) ?? []).map(card),
      ];
    }).flat();
  const fold = ({ start, end }: { start: number; end: number }): Html[] => {
    const key = `${file}:${start}:${end}`;
    const count = end - start + 1;
    const revealed = (model.expandedCode[key] ?? 0) > 0;
    return [
      ...(revealed ? lines(start, end) : []),
      h.keyed("div")(
        key,
        [h.Class("code-fold")],
        [
          h.button(
            [
              h.Type("button"),
              h.AriaLabel(revealed ? `Collapse ${count} lines` : `${count} lines hidden Show all`),
              h.Title(revealed ? "Collapse these lines" : "Show all hidden lines"),
              h.OnClick(Message.ExpandedCode({ key, count: revealed ? 0 : count })),
            ],
            [
              icon({ name: revealed ? "collapse" : "expand", h }),
              revealed ? `Collapse ${count} lines` : `${count} lines hidden`,
            ],
          ),
        ],
      ),
    ];
  };
  return h.section(
    [h.Class("code")],
    [
      h.div(
        [h.Class("code__bar")],
        [
          h.span([h.Class("code__file")], [icon({ name: "file", h }), h.span([], [file])]),
          ...(change === undefined
            ? []
            : [h.span([h.Class(`code__status code__status--${change.status}`)], [change.status])]),
          ...(collapsible
            ? [
                h.button(
                  [
                    h.Type("button"),
                    h.Class("code__toggle"),
                    h.OnClick(Message.ExpandedCode({ key: `${file}:all`, count: expanded ? 0 : 1 })),
                  ],
                  [expanded ? "Collapse unchanged code" : "Expand all code"],
                ),
              ]
            : []),
          change === undefined || change.hunks.length === 0
            ? h.span([h.Class("code__hint")], [`${allLines.length} lines`])
            : h.button(
                [
                  h.Type("button"),
                  h.Class("code__toggle"),
                  h.OnClick(Message.SelectedCodeView({ codeView: model.codeView === "focused" ? "full" : "focused" })),
                ],
                [model.codeView === "focused" ? `Full file · ${allLines.length} lines` : "Changes only"],
              ),
        ],
      ),
      h.keyed("div")(
        file,
        [h.Class("code__lines")],
        [
          ...(anchors.get(0) ?? []).map(card),
          ...segments.flatMap((segment) =>
            segment.kind === "lines" || expanded ? lines(segment.start, segment.end) : fold(segment),
          ),
          ...(diff && !deleted ? (deletions.get(allLines.length + 1) ?? []) : []).map((row) =>
            renderLine({ ...row, kind: "deletion" }),
          ),
        ],
      ),
    ],
  );
};
