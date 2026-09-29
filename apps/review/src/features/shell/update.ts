import { modifyFields } from "foldkit/struct";

import { clampSidebarWidth, type Model } from "../../shared/model";
import type { Handlers } from "../../shared/update";
import { persistChange } from "../session/update";
import type { fields } from "./messages";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  ToggledSidebar: () =>
    persistChange({ model, change: (current) => modifyFields(current, { sidebarOpen: (value) => !value }) }),
  StartedSidebarResize: () => ({ model: modifyFields(model, { resizingSidebar: () => true }) }),
  ResizedSidebar: ({ width }) => ({ model: modifyFields(model, { sidebarWidth: () => clampSidebarWidth(width) }) }),
  NudgedSidebar: ({ width }) =>
    persistChange({
      model,
      change: (current) => modifyFields(current, { sidebarWidth: () => clampSidebarWidth(width) }),
    }),
  EndedSidebarResize: () =>
    persistChange({ model, change: (current) => modifyFields(current, { resizingSidebar: () => false }) }),
});
