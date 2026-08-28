import { Clock, Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import {
  CompletedAction,
  CompletedFinish,
  CompletedPersistence,
  CompletedUtility,
  FailedAction,
  FailedFinish,
  FailedLoadState,
  FailedPersistence,
  LoadedState,
  PreparedDetachedFinish,
  ExpiredToast,
  PerformedDomEffect,
  RemovedToast,
} from "./message";
import { PersistedReview } from "./model";
import { EditorApplicationId, ReviewStatePayload } from "./types";

const errorMessage = (value: unknown): string =>
  value instanceof Error ? value.message : "The review service returned an unexpected response.";

const fetchState = Effect.gen(function* () {
  const embedded = Reflect.get(window, "__AGENTLINT_REVIEW__");
  if (embedded !== undefined) {
    return yield* S.decodeUnknownEffect(ReviewStatePayload)(embedded);
  }

  const response = yield* Effect.promise(() => fetch("/api/state"));
  if (!response.ok) {
    return yield* Effect.fail(new Error(`Could not load the review (${response.status}).`));
  }
  const body = yield* Effect.promise(() => response.json());
  return yield* S.decodeUnknownEffect(ReviewStatePayload)(body);
});

export const reviewStorageKey = (state: typeof ReviewStatePayload.Type): string =>
  `agentlint:review:v1:${encodeURIComponent(state.project)}:${encodeURIComponent(state.base)}:${state.mode}`;

const readSavedReview = (state: typeof ReviewStatePayload.Type) =>
  Effect.sync(() => {
    const value = localStorage.getItem(reviewStorageKey(state));
    if (value === null) return null;
    try {
      return S.decodeUnknownSync(S.fromJsonString(PersistedReview))(value);
    } catch {
      return null;
    }
  });

export const LoadReview = Command.define("LoadReview", {
  messages: [LoadedState, FailedLoadState],
  execute: fetchState.pipe(
    Effect.flatMap((state) => readSavedReview(state).pipe(Effect.map((saved) => LoadedState({ state, saved })))),
    Effect.catch((error) => Effect.succeed(FailedLoadState({ message: errorMessage(error) }))),
  ),
});

export const PersistReview = Command.define("PersistReview", {
  args: { key: S.String, content: S.String },
  messages: [CompletedPersistence, FailedPersistence],
  execute: ({ key, content }) =>
    Effect.sync(() => {
      localStorage.setItem(key, content);
      Reflect.set(window, "__AGENTLINT_REVIEW_DIRTY__", true);
      return CompletedPersistence();
    }).pipe(Effect.catch((error) => Effect.succeed(FailedPersistence({ message: errorMessage(error) })))),
});

export const SubmitAction = Command.define("SubmitAction", {
  args: { findingId: S.String, requestJson: S.String },
  messages: [CompletedAction, FailedAction],
  execute: ({ findingId, requestJson }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fetch("/api/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestJson,
        }),
      );
      const result = (yield* Effect.promise(() => response.json())) as {
        readonly message?: string;
      };
      if (!response.ok) {
        return yield* Effect.fail(new Error(result.message ?? `Action failed (${response.status}).`));
      }
      const state = yield* fetchState;
      return CompletedAction({
        findingId,
        state,
        message: result.message ?? "Review saved.",
      });
    }).pipe(Effect.catch((error) => Effect.succeed(FailedAction({ findingId, message: errorMessage(error) })))),
});

export const FinishReview = Command.define("FinishReview", {
  messages: [CompletedFinish, FailedFinish],
  execute: Effect.gen(function* () {
    const response = yield* Effect.promise(() => fetch("/api/finish", { method: "POST" }));
    const result = (yield* Effect.promise(() => response.json())) as {
      readonly summary?: string;
      readonly feedback?: string;
      readonly acceptanceOutput?: string;
    };
    if (!response.ok) {
      return yield* Effect.fail(new Error(`Could not finish the review (${response.status}).`));
    }
    Reflect.set(window, "__AGENTLINT_REVIEW_DIRTY__", false);
    return CompletedFinish({
      summary: result.summary ?? "Review complete.",
      feedback: result.feedback ?? "",
      acceptanceOutput: result.acceptanceOutput ?? "",
    });
  }).pipe(Effect.catch((error) => Effect.succeed(FailedFinish({ message: errorMessage(error) })))),
});

export const PrepareDetachedFinish = Command.define("PrepareDetachedFinish", {
  messages: [PreparedDetachedFinish],
  execute: Effect.gen(function* () {
    const milliseconds = yield* Clock.currentTimeMillis;
    yield* Effect.promise(() => fetch("/api/finish", { method: "POST" })).pipe(Effect.ignore);
    Reflect.set(window, "__AGENTLINT_REVIEW_DIRTY__", false);
    return PreparedDetachedFinish({ acceptedAt: new Date(milliseconds).toISOString() });
  }),
});

export const CopyText = Command.define("CopyText", {
  args: { content: S.String, successMessage: S.optional(S.String) },
  messages: [CompletedUtility],
  execute: ({ content, successMessage }) =>
    Effect.tryPromise(async () => {
      try {
        await navigator.clipboard.writeText(content);
        return;
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        let copied = false;
        try {
          textarea.select();
          copied = document.execCommand("copy");
        } finally {
          textarea.remove();
        }
        if (!copied) throw new Error("Browser clipboard access is unavailable.");
      }
    }).pipe(
      Effect.as(CompletedUtility({ message: successMessage ?? "Agent instructions copied.", tone: "success" })),
      Effect.catch(() =>
        Effect.succeed(
          CompletedUtility({ message: "Copy failed. Select the text and copy it manually.", tone: "danger" }),
        ),
      ),
    ),
});

export const OpenEditor = Command.define("OpenEditor", {
  args: { findingId: S.String, application: EditorApplicationId },
  messages: [CompletedUtility],
  execute: ({ findingId, application }) =>
    Effect.tryPromise(async () => {
      const response = await fetch("/api/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingId, application }),
      });
      const result = (await response.json()) as { readonly message?: string };
      return CompletedUtility({
        message: result.message ?? (response.ok ? "Opening the finding…" : "Could not open the finding."),
        tone: response.ok ? "success" : "danger",
      });
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(CompletedUtility({ message: "Could not reach the local editor service.", tone: "danger" })),
      ),
    ),
});

export const DownloadText = Command.define("DownloadText", {
  args: { content: S.String, filename: S.String },
  messages: [CompletedUtility],
  execute: ({ content, filename }) =>
    Effect.sync(() => {
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      return CompletedUtility({ message: `${filename} downloaded.`, tone: "success" });
    }),
});

/** DOM side effects behind keyboard shortcuts. They never change the model. */
export const FocusElement = Command.define("FocusElement", {
  args: { selector: S.String },
  messages: [PerformedDomEffect],
  execute: ({ selector }) =>
    Effect.sync(() => {
      const element = document.querySelector<HTMLElement>(selector);
      element?.focus();
      if (element instanceof HTMLTextAreaElement) element.setSelectionRange(element.value.length, element.value.length);
      return PerformedDomEffect();
    }),
});

export const TogglePopover = Command.define("TogglePopover", {
  args: { id: S.String },
  messages: [PerformedDomEffect],
  execute: ({ id }) =>
    Effect.sync(() => {
      document.getElementById(id)?.togglePopover();
      return PerformedDomEffect();
    }),
});

export const BlurActive = Command.define("BlurActive", {
  messages: [PerformedDomEffect],
  execute: Effect.sync(() => {
    for (const popover of document.querySelectorAll<HTMLElement>("[popover]:popover-open")) popover.hidePopover();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return PerformedDomEffect();
  }),
});

export const RevealSelectedRow = Command.define("RevealSelectedRow", {
  messages: [PerformedDomEffect],
  execute: Effect.sync(() => {
    requestAnimationFrame(() => {
      document.querySelector(".row--selected")?.scrollIntoView({ block: "nearest" });
    });
    return PerformedDomEffect();
  }),
});

export const ExpireToast = Command.define("ExpireToast", {
  args: { id: S.Number, delayMs: S.Number },
  messages: [ExpiredToast],
  execute: ({ id, delayMs }) => Effect.sleep(delayMs).pipe(Effect.as(ExpiredToast({ id }))),
});

export const RemoveToast = Command.define("RemoveToast", {
  args: { id: S.Number },
  messages: [RemovedToast],
  execute: ({ id }) => Effect.sleep(180).pipe(Effect.as(RemovedToast({ id }))),
});
