import { Schema as S } from "effect";

import { ToastTone } from "../../model";

export const fields = {
  HoveredToasts: {},
  LeftToasts: {},
  ClickedDismissToast: { id: S.Number },
  ExpiredToast: { id: S.Number },
  RemovedToast: { id: S.Number },
  /** Outcome of a utility command (copy, open, download) reported as a toast. */
  CompletedUtility: { message: S.String, tone: ToastTone },
} satisfies Record<string, S.Struct.Fields>;
