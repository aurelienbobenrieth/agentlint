import { evo } from "foldkit/struct";

import { clampSidebarWidth, type Model } from "../../model";
import type { Handlers } from "../../shared/update";
import { persistChange } from "../session/update";
import type { fields } from "./messages";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  ToggledSidebar: () => persistChange(model, (current) => evo(current, { sidebarOpen: (value) => !value })),
  StartedSidebarResize: () => ({ model: evo(model, { resizingSidebar: () => true }) }),
  ResizedSidebar: ({ width }) => ({ model: evo(model, { sidebarWidth: () => clampSidebarWidth(width) }) }),
  EndedSidebarResize: () => persistChange(model, (current) => evo(current, { resizingSidebar: () => false })),
});
