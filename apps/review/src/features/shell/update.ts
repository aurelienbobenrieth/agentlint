import { modifyFields } from "foldkit/struct";

import { clampFilesWidth, clampSidebarWidth, type Model } from "../../shared/model";
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
  ToggledFiles: () =>
    persistChange({ model, change: (current) => modifyFields(current, { filesOpen: (open) => !open }) }),
  ToggledFilesSheet: () => ({ model: modifyFields(model, { filesSheetOpen: (open) => !open }) }),
  StartedFilesResize: () => ({ model: modifyFields(model, { resizingFiles: () => true }) }),
  ResizedFiles: ({ width }) => ({ model: modifyFields(model, { filesWidth: () => clampFilesWidth(width) }) }),
  NudgedFiles: ({ width }) =>
    persistChange({ model, change: (current) => modifyFields(current, { filesWidth: () => clampFilesWidth(width) }) }),
  EndedFilesResize: () =>
    persistChange({ model, change: (current) => modifyFields(current, { resizingFiles: () => false }) }),
});
