import type { Schema as S } from "effect";

import { Shortcut } from "../../model";

export const fields = {
  PressedShortcut: { action: Shortcut },
  ToggledHelp: {},
  /** Also sent by the native dialog's `cancel`, which can fire without any keydown reaching the app. */
  ClosedHelp: {},
  /** Emitted by DOM-only commands (focus, scroll, popovers). The model ignores it. */
  PerformedDomEffect: {},
} satisfies Record<string, S.Struct.Fields>;
