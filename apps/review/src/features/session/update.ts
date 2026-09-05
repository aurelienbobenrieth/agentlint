import { evo } from "foldkit/struct";

import { type Model, persistedReview, Screen } from "../../model";
import type { Handlers, UpdateReturn } from "../../shared/update";
import { enqueueToast } from "../toasts/update";
import { DelayPersist, PersistReview, reviewStorageKey } from "./command";
import type { fields } from "./messages";

/** Write the review to localStorage now. Discrete actions (clicks, toggles, decisions) use this. */
export const persist = (model: Model): UpdateReturn => {
  if (model.screen._tag !== "Reviewing") return { model };
  const saving = evo(model, { saveState: () => "saving" as const });
  return {
    model: saving,
    commands: [
      PersistReview({
        key: reviewStorageKey(model.screen.state),
        content: JSON.stringify(persistedReview(saving)),
      }),
    ],
  };
};

export const persistChange = (model: Model, change: (model: Model) => Model): UpdateReturn => persist(change(model));

/** Write after the reviewer pauses typing. The model changes immediately; only the write is delayed. */
export const persistLater = (model: Model): UpdateReturn => {
  if (model.screen._tag !== "Reviewing") return { model };
  const version = model.saveVersion + 1;
  return {
    model: evo(model, { saveVersion: () => version, saveState: () => "saving" as const }),
    commands: [DelayPersist({ version })],
  };
};

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  LoadedState: ({ state, saved }) => {
    const restored = evo(model, {
      screen: () => Screen.Reviewing({ state }),
      view: () => saved?.view ?? model.view,
      facets: () => saved?.facets ?? model.facets,
      groupBy: () => saved?.groupBy ?? model.groupBy,
      codeView: () => saved?.codeView ?? model.codeView,
      guidanceOpen: () => saved?.guidanceOpen ?? model.guidanceOpen,
      sidebarOpen: () => saved?.sidebarOpen ?? model.sidebarOpen,
      sidebarWidth: () => saved?.sidebarWidth ?? model.sidebarWidth,
      preferredApplication: () => saved?.preferredApplication ?? model.preferredApplication,
      query: () => saved?.query ?? model.query,
      selectedFindingId: () => saved?.selectedFindingId ?? null,
      drafts: () => saved?.drafts ?? model.drafts,
      toasts: () => [],
      saveState: () => (saved === null ? ("idle" as const) : ("saved" as const)),
    });
    Reflect.set(window, "__AGENTLINT_REVIEW_DIRTY__", state.findings.length > 0);
    return { model: restored };
  },
  FailedLoadState: ({ message }) => ({ model: evo(model, { screen: () => Screen.LoadFailed({ message }) }) }),
  ElapsedPersistDelay: ({ version }) => (version === model.saveVersion ? persist(model) : { model }),
  CompletedPersistence: () => ({ model: evo(model, { saveState: () => "saved" as const }) }),
  FailedPersistence: ({ message }) =>
    enqueueToast(evo(model, { saveState: () => "failed" as const }), `Local save failed: ${message}`, "danger"),
});
