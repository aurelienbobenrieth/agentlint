import type { Schema as S } from "effect";

import { Shortcut } from "../../model";

export const fields = {
  PressedShortcut: { action: Shortcut },
  ToggledHelp: {},
  /** Emitted by DOM-only commands (focus, scroll, popovers). The model ignores it. */
  PerformedDomEffect: {},
} satisfies Record<string, S.Struct.Fields>;
