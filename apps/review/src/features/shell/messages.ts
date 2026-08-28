import { Schema as S } from "effect";

export const fields = {
  ToggledSidebar: {},
  StartedSidebarResize: {},
  ResizedSidebar: { width: S.Number },
  EndedSidebarResize: {},
} satisfies Record<string, S.Struct.Fields>;
