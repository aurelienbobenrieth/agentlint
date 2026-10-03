import { Runtime, Subscription } from "foldkit";

import { hasEmbeddedState, LoadReview, PollProgress } from "./features/session/command";
import { filesResize, sidebarResize } from "./features/shell/subscription";
import { keyboard } from "./features/shortcuts/subscription";
import { Message } from "./message";
import { FILES_DEFAULT, Model, Screen, SIDEBAR_DEFAULT } from "./shared/model";
import { update } from "./update";
import { view } from "./view";

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    screen: Screen.Loading({ progress: null }),
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
    viewedFile: null,
    collapsedDirectories: [],
    filesOpen: true,
    filesWidth: FILES_DEFAULT,
    resizingFiles: false,
    filesSheetOpen: false,
    toastsPaused: false,
    modKey: typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘" : "Ctrl",
    toasts: [],
    nextToastId: 1,
    persistFailed: false,
    saveVersion: 0,
  },
  commands: hasEmbeddedState() ? [LoadReview()] : [LoadReview(), PollProgress()],
});

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  sidebarResize: sidebarResize(entry),
  filesResize: filesResize(entry),
  keyboard: keyboard(entry),
}));

export { Message, Model, update, view };
