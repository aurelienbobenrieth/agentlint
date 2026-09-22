import { evo } from "foldkit/struct";

import type { Model, ToastTone } from "../../shared/model";
import type { Handlers, UpdateReturn } from "../../shared/update";
import { ExpireToast, RemoveToast } from "./command";
import type { fields } from "./messages";

const toastDuration = (tone: ToastTone): number => (tone === "success" ? 4_000 : 6_000);

const TOAST_LIMIT = 5;
type Toasts = Model["toasts"];

/**
 * Over the limit, the oldest toasts that expire on their own go first. A danger toast reports something the reviewer
 * has to know (a failed save, a rejected decision), so only dismissing it removes it.
 */
const capped = (toasts: Toasts): Toasts => {
  const excess = Math.max(0, toasts.length - TOAST_LIMIT);
  const removed = new Set(
    toasts
      .filter((toast) => toast.tone !== "danger")
      .slice(0, excess)
      .map((toast) => toast.id),
  );
  return toasts.filter((toast) => !removed.has(toast.id));
};

/**
 * Danger toasts stay until dismissed; the stack keeps the five newest of the others.
 */
export const enqueueToast = ({
  model,
  message,
  tone = "neutral",
}: {
  readonly model: Model;
  readonly message: string;
  readonly tone?: ToastTone;
}): UpdateReturn => {
  const id = model.nextToastId;
  const next = evo(model, {
    toasts: (toasts) => capped([...toasts, { id, message, tone, phase: "visible" as const }]),
    nextToastId: (value) => value + 1,
  });
  return tone === "danger"
    ? { model: next }
    : { model: next, commands: [ExpireToast({ id, delayMs: toastDuration(tone) })] };
};

export const dismissToast = ({ model, id }: { readonly model: Model; readonly id: number }): UpdateReturn => {
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
  ClickedDismissToast: ({ id }) => dismissToast({ model, id }),
  ExpiredToast: ({ id }) =>
    model.toastsPaused && model.toasts.some((toast) => toast.id === id)
      ? { model, commands: [ExpireToast({ id, delayMs: 1_500 })] }
      : dismissToast({ model, id }),
  RemovedToast: ({ id }) => ({ model: evo(model, { toasts: (toasts) => toasts.filter((toast) => toast.id !== id) }) }),
  CompletedUtility: ({ message, tone }) => enqueueToast({ model, message, tone }),
});
