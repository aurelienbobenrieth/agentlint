import { evo } from "foldkit/struct";

import { type Model, persistedReview, Screen } from "../../model";
import { duplicateFindingId } from "../../shared/selectors";
import { appendCommands, type Handlers, type UpdateReturn } from "../../shared/update";
import { reconcileSelection } from "../list/selection";
import { enqueueToast } from "../toasts/update";
import { DelayPersist, LoadReview, MarkDirty, PersistReview, reviewStorageKey } from "./command";
import type { fields } from "./messages";

/** Leaving loses work only when a detached review holds a decision that was not exported yet.
 *  Attached reviews never do: the server persists each decision. */
const hasUnexportedDecisions = (model: Model): boolean =>
  model.screen._tag === "Reviewing" &&
  model.screen.state.transport === "detached" &&
  Object.values(model.drafts).some((draft) => draft.disposition !== "none");

/** Write the review to localStorage now. Discrete actions (clicks, toggles, decisions) use this. */
export const persist = (model: Model): UpdateReturn => {
  if (model.screen._tag !== "Reviewing") return { model };
  return {
    model,
    commands: [
      PersistReview({
        key: reviewStorageKey(model.screen.state),
        content: JSON.stringify(persistedReview(model)),
        dirty: hasUnexportedDecisions(model),
      }),
    ],
  };
};

export const persistChange = (model: Model, change: (model: Model) => Model): UpdateReturn => persist(change(model));

/** Write after the reviewer pauses typing. The model changes immediately; only the write is delayed. */
export const persistLater = (model: Model): UpdateReturn => {
  if (model.screen._tag !== "Reviewing") return { model };
  const version = model.saveVersion + 1;
  return { model: evo(model, { saveVersion: () => version }), commands: [DelayPersist({ version })] };
};

/** Selection, drafts and exports key on the finding id. A state that repeats one shows one finding and
 *  would export a decision for both, so it is refused outright. */
export const rejectDuplicateIds = (model: Model, id: string): UpdateReturn => ({
  model: evo(model, {
    screen: () =>
      Screen.LoadFailed({
        message: `This review lists the finding id "${id}" more than once, so a decision could not be tied to one finding. Generate the review again.`,
      }),
    busyFindingId: () => null,
  }),
});

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  LoadedState: ({ state, saved, savedUnreadable }) => {
    const duplicate = duplicateFindingId(state);
    if (duplicate !== null) return rejectDuplicateIds(model, duplicate);
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
      busyFindingId: () => null,
      refreshFailed: () => false,
      toasts: () => [],
    });
    // The selection always names a listed finding. Nothing was decided yet, so shortcuts need not wait.
    const selected = evo(reconcileSelection(restored, restored).model, { selectionSettled: () => true });
    const commands = [MarkDirty({ dirty: hasUnexportedDecisions(selected) })];
    if (!savedUnreadable) return { model: selected, commands };
    return appendCommands(
      enqueueToast(
        selected,
        `Decisions saved in this browser by another agentlint version could not be read and are not shown. The data was kept in local storage under "${reviewStorageKey(state)}:bak".`,
        "danger",
      ),
      commands,
    );
  },
  FailedLoadState: ({ message }) =>
    // A failed reload keeps the review on screen; only the first load has nothing else to show.
    model.screen._tag === "Reviewing"
      ? enqueueToast(model, `Reload failed: ${message}`, "danger")
      : { model: evo(model, { screen: () => Screen.LoadFailed({ message }) }) },
  ClickedReloadReview: () => ({ model, commands: [LoadReview()] }),
  ElapsedPersistDelay: ({ version }) => (version === model.saveVersion ? persist(model) : { model }),
  CompletedPersistence: () => ({ model: model.persistFailed ? evo(model, { persistFailed: () => false }) : model }),
  // A failing store fails on every write. The reviewer is told once, until a write succeeds again.
  FailedPersistence: ({ message }) =>
    model.persistFailed
      ? { model }
      : enqueueToast(
          evo(model, { persistFailed: () => true }),
          `Local save failed: ${message}. New decisions exist only in this tab until it succeeds.`,
          "danger",
        ),
});
