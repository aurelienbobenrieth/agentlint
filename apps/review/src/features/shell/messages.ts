import { Schema as S } from "effect";

export const fields = {
  ToggledSidebar: {},
  StartedSidebarResize: {},
  ResizedSidebar: { width: S.Number },
  /**
   * Keyboard resize from the focused separator. Unlike a drag it has no end event, so it persists at once.
   */
  NudgedSidebar: { width: S.Number },
  EndedSidebarResize: {},
  ToggledFiles: {},
  /**
   * The narrow-screen files sheet. Separate from the docked pane so opening it on a phone never hides the pane on a
   * desktop.
   */
  ToggledFilesSheet: {},
  StartedFilesResize: {},
  /**
   * The pane is docked right, so its width is the distance from the pointer to the window's right edge.
   */
  ResizedFiles: { width: S.Number },
  NudgedFiles: { width: S.Number },
  EndedFilesResize: {},
} satisfies Record<string, S.Struct.Fields>;
