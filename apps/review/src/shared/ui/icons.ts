import type { Html, HtmlBuilder } from "foldkit/html";

import type { EditorApplicationId } from "@aurelienbbn/agentlint/contract";
import type { Message } from "../../message";

export type IconName =
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

export const icon = (name: IconName, h: HtmlBuilder<Message>): Html =>
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

export const appIcon = (application: EditorApplicationId, h: HtmlBuilder<Message>): Html =>
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
