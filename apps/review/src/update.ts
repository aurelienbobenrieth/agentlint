import * as decision from "./features/decision/update";
import * as detail from "./features/detail/update";
import * as filters from "./features/filters/update";
import * as finish from "./features/finish/update";
import * as list from "./features/list/update";
import * as session from "./features/session/update";
import * as shell from "./features/shell/update";
import * as shortcuts from "./features/shortcuts/update";
import * as toasts from "./features/toasts/update";
import { Message } from "./message";
import type { Model } from "./model";
import type { UpdateReturn } from "./shared/update";

/** Every feature contributes the handlers for the tags it declared; `match` proves the union is covered. */
export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ...session.cases(model),
    ...list.cases(model),
    ...filters.cases(model),
    ...detail.cases(model),
    ...decision.cases(model),
    ...shortcuts.cases(model, update),
    ...toasts.cases(model),
    ...finish.cases(model),
    ...shell.cases(model),
  });
