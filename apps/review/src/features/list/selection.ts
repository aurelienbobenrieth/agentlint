import { evo } from "foldkit/struct";

import type { Model } from "../../model";
import { deriveReview } from "../../shared/selectors";
import type { UpdateReturn } from "../../shared/update";
import { SettleSelection } from "./command";

/** The reviewer chose this finding themselves, so decision shortcuts may act on it at once. */
export const selectFinding = (model: Model, findingId: string | null): Model =>
  evo(model, {
    selectedFindingId: () => findingId,
    selectionSettled: () => true,
    selectionVersion: (version) => version + 1,
  });

/** Keep the selection on a listed finding after `after` changed what the list shows. When the selected
 *  finding left the list, its next listed neighbour takes over (else the previous one, else nothing), and
 *  decision shortcuts pause until `SettledSelection`: the reviewer has not looked at that finding yet. */
export const reconcileSelection = (before: Model, after: Model): UpdateReturn => {
  if (after.screen._tag !== "Reviewing") return { model: after };
  const listed = deriveReview(after.screen.state, after).visible;
  if (listed.some(({ id }) => id === after.selectedFindingId)) return { model: after };
  const remaining = new Set(listed.map(({ id }) => id));
  const previous = before.screen._tag === "Reviewing" ? deriveReview(before.screen.state, before).visible : [];
  const index = previous.findIndex(({ id }) => id === before.selectedFindingId);
  const neighbour =
    index < 0
      ? undefined
      : (previous.slice(index + 1).find(({ id }) => remaining.has(id)) ??
        previous.slice(0, index).findLast(({ id }) => remaining.has(id)));
  const next = neighbour?.id ?? listed[0]?.id ?? null;
  if (next === after.selectedFindingId) return { model: after };
  const version = after.selectionVersion + 1;
  return {
    model: evo(after, {
      selectedFindingId: () => next,
      selectionSettled: () => next === null,
      selectionVersion: () => version,
    }),
    commands: next === null ? [] : [SettleSelection({ version })],
  };
};
