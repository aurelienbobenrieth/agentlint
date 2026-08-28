import { evo } from "foldkit/struct";

import type { Model, ToastTone } from "../../model";
import type { Handlers, UpdateReturn } from "../../shared/update";
import { ExpireToast, RemoveToast } from "./command";
import type { fields } from "./messages";

const toastDuration = (tone: ToastTone): number => (tone === "success" ? 4_000 : 6_000);

/** Danger toasts stay until dismissed; the stack keeps the five newest. */
export const enqueueToast = (model: Model, message: string, tone: ToastTone = "neutral"): UpdateReturn => {
  const id = model.nextToastId;
  const next = evo(model, {
    toasts: (toasts) => [...toasts, { id, message, tone, phase: "visible" as const }].slice(-5),
    nextToastId: (value) => value + 1,
  });
  return tone === "danger"
    ? { model: next }
    : { model: next, commands: [ExpireToast({ id, delayMs: toastDuration(tone) })] };
};

export const dismissToast = (model: Model, id: number): UpdateReturn => {
  const toast = model.toasts.find((candidate) => candidate.id === id);
  if (toast === undefined || toast.phase === "leaving") return { model };
  return {
    model: evo(model, {
      toasts: (toasts) =>
        toasts.map((candidate) => (candidate.id === id ? { ...candidate, phase: "leaving" as const } : candidate)),
    }),
    commands: [RemoveToast({ id })],
  };
};

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  HoveredToasts: () => ({ model: evo(model, { toastsPaused: () => true }) }),
  LeftToasts: () => ({ model: evo(model, { toastsPaused: () => false }) }),
  ClickedDismissToast: ({ id }) => dismissToast(model, id),
  ExpiredToast: ({ id }) =>
    model.toastsPaused && model.toasts.some((toast) => toast.id === id)
      ? { model, commands: [ExpireToast({ id, delayMs: 1_500 })] }
      : dismissToast(model, id),
  RemovedToast: ({ id }) => ({ model: evo(model, { toasts: (toasts) => toasts.filter((toast) => toast.id !== id) }) }),
  CompletedUtility: ({ message, tone }) => enqueueToast(model, message, tone),
});
