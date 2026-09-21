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
} satisfies Record<string, S.Struct.Fields>;
