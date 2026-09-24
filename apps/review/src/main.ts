import { Runtime, Subscription } from "foldkit";

import { LoadReview } from "./features/session/command";
import { sidebarResize } from "./features/shell/subscription";
import { keyboard } from "./features/shortcuts/subscription";
import { Message } from "./message";
import { Model, Screen, SIDEBAR_DEFAULT } from "./shared/model";
import { update } from "./update";
import { view } from "./view";

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    screen: Screen.Loading(),
    view: "queue",
    facets: { statuses: [], authorities: [], lifecycles: [], ruleIds: [] },
    groupBy: "file",
    codeView: "focused",
    guidanceOpen: false,
    sidebarOpen: true,
    sidebarWidth: SIDEBAR_DEFAULT,
    resizingSidebar: false,
    preferredApplication: null,
    query: "",
    selectedFindingId: null,
    selectionSettled: true,
    selectionVersion: 0,
    drafts: {},
    busyFindingId: null,
    finishing: false,
    refreshFailed: false,
    pendingExports: [],
    helpOpen: false,
    independentReview: false,
    independentNotes: {},
    revealedFindings: [],
    toastsPaused: false,
    modKey: typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘" : "Ctrl",
    toasts: [],
    nextToastId: 1,
    persistFailed: false,
    saveVersion: 0,
  },
  commands: [LoadReview()],
});

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  sidebarResize: sidebarResize(entry),
  keyboard: keyboard(entry),
}));

export { Message, Model, update, view };
