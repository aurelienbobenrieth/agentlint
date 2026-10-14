import { modifyFields } from "foldkit/struct";

import type { Model } from "../../shared/model";
import { deriveReview, draftFor, findingById } from "../../shared/selectors";
import { appendCommands, type Handlers } from "../../shared/update";
import { persistChange } from "../session/update";
import { enqueueToast } from "../toasts/update";
import { CopyText, OpenEditor } from "./command";
import { directoryPaths, fileTree, setAllDirectories } from "./files";
import type { fields } from "./messages";
import { findingContext } from "./selectors";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  SetFindingGuidance: ({ findingId, open }) => ({
    model: modifyFields(model, {
      guidanceFindingIds: (ids) => (open ? [...new Set([...ids, findingId])] : ids.filter((id) => id !== findingId)),
    }),
  }),
  ExpandedCode: ({ key, count }) => ({
    model: modifyFields(model, {
      expandedCode: (expanded) => ({
        ...(key.endsWith(":all") && count === 0
          ? Object.fromEntries(Object.entries(expanded).filter(([item]) => !item.startsWith(key.slice(0, -3))))
          : expanded),
        [key]: count,
      }),
    }),
  }),
  EditedDecision: ({ findingId }) => ({
    model: modifyFields(model, {
      selectedFindingId: () => findingId,
      editingDecisionIds: (ids) => [...new Set([...ids, findingId])],
      drafts: (drafts) => {
        const finding =
          model.screen._tag === "Reviewing" ? findingById({ state: model.screen.state, findingId }) : undefined;
        const draft = draftFor({ model, findingId });
        return finding?.acceptance === null || finding?.acceptance === undefined || draft.reason.trim().length > 0
          ? drafts
          : { ...drafts, [findingId]: { ...draft, reason: finding.acceptance.reason } };
      },
    }),
  }),
  ToggledIndependentReview: () => ({
    model: modifyFields(model, {
      independentReview: (active) => !active,
      revealedFindings: () => [],
      independentNotes: () => ({}),
    }),
  }),
  UpdatedIndependentNote: ({ findingId, value }) => ({
    model: modifyFields(model, { independentNotes: (notes) => ({ ...notes, [findingId]: value }) }),
  }),
  RevealedPriorDecision: ({ findingId }) => {
    const note = model.independentNotes[findingId]?.trim();
    if (!note) return { model };
    return persistChange({
      model,
      change: (current) =>
        modifyFields(current, {
          revealedFindings: (ids) => [...new Set([...ids, findingId])],
          drafts: (drafts) => ({
            ...drafts,
            [findingId]: { ...draftFor({ model: current, findingId }), reason: note },
          }),
        }),
    });
  },
  // Picking a file from the narrow-screen sheet closes it, so the code it shows is visible.
  SelectedFile: ({ findingId, file }) => ({
    model: modifyFields(model, { viewedFile: () => ({ findingId, file }), filesSheetOpen: () => false }),
  }),
  ToggledFileDirectory: ({ path }) => ({
    model: modifyFields(model, {
      collapsedDirectories: (paths) =>
        paths.includes(path) ? paths.filter((item) => item !== path) : [...paths, path],
    }),
  }),
  SetAllFileDirectories: ({ collapsed: fold }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    // The finding on screen, including the first-row fallback, so the shortcut folds the tree the reviewer sees.
    const selected = deriveReview({ state: model.screen.state, model }).selected;
    if (selected === undefined) return { model };
    const paths = directoryPaths(fileTree(selected.relatedFiles));
    return {
      model: modifyFields(model, {
        collapsedDirectories: (collapsed) => setAllDirectories({ collapsed, paths, fold }),
      }),
    };
  },
  SelectedCodeView: ({ codeView }) =>
    persistChange({ model, change: (current) => modifyFields(current, { codeView: () => codeView }) }),
  ToggledGuidance: () => ({
    model: modifyFields(model, {
      guidanceFindingIds: (ids) =>
        model.selectedFindingId === null
          ? ids
          : ids.includes(model.selectedFindingId)
            ? ids.filter((id) => id !== model.selectedFindingId)
            : [...ids, model.selectedFindingId],
    }),
  }),
  SetGuidanceOpen: ({ open }) =>
    open === model.guidanceOpen
      ? { model }
      : persistChange({ model, change: (current) => modifyFields(current, { guidanceOpen: () => open }) }),
  ClickedCopyFindingContext: ({ findingId }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    const finding = findingById({ state: model.screen.state, findingId });
    return finding === undefined
      ? enqueueToast({ model, message: "The finding is no longer available.", tone: "danger" })
      : {
          model,
          commands: [
            CopyText({ content: findingContext({ finding, model }), successMessage: "Finding context copied." }),
          ],
        };
  },
  ClickedOpenFinding: ({ findingId }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    const finding = findingById({ state: model.screen.state, findingId });
    const application = model.screen.state.applications.find(({ id }) => id === model.preferredApplication);
    return finding?.editor !== null && application !== undefined
      ? { model, commands: [OpenEditor({ findingId, application: application.id })] }
      : enqueueToast({
          model,
          message: "Choose an available application before opening this finding.",
          tone: "neutral",
        });
  },
  SelectedEditorApplication: ({ findingId, application }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    const finding = findingById({ state: model.screen.state, findingId });
    const available = model.screen.state.applications.some(({ id }) => id === application);
    if (finding?.editor === null || !available) {
      return enqueueToast({ model, message: "That application is not available for this review.", tone: "danger" });
    }
    return appendCommands({
      result: persistChange({
        model,
        change: (current) => modifyFields(current, { preferredApplication: () => application }),
      }),
      commands: [OpenEditor({ findingId, application })],
    });
  },
});
