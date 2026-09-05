import { defineMessageUnion } from "foldkit/message";

import { fields as decision } from "./features/decision/messages";
import { fields as detail } from "./features/detail/messages";
import { fields as filters } from "./features/filters/messages";
import { fields as finish } from "./features/finish/messages";
import { fields as list } from "./features/list/messages";
import { fields as session } from "./features/session/messages";
import { fields as shell } from "./features/shell/messages";
import { fields as shortcuts } from "./features/shortcuts/messages";
import { fields as toasts } from "./features/toasts/messages";

/** One Message universe. Each feature declares its own tags; the root only assembles them. */
export const Message = defineMessageUnion({
  ...session,
  ...list,
  ...filters,
  ...detail,
  ...decision,
  ...shortcuts,
  ...toasts,
  ...finish,
  ...shell,
});
export type Message = typeof Message.Type;
