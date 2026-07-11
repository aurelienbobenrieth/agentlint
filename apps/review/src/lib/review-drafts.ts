import type { ReviewActionType } from "@/types";

export interface ReviewDraft {
  readonly action: ReviewActionType;
  readonly reason: string;
}

const PREFIX = "agentlint:review-draft:";

export function readReviewDraft(key: string): ReviewDraft | null {
  try {
    const value = localStorage.getItem(PREFIX + key);
    if (!value) return null;
    const params = new URLSearchParams(value);
    const action = params.get("action");
    const reason = params.get("reason");
    return action && reason !== null ? { action: action as ReviewActionType, reason } : null;
  } catch {
    return null;
  }
}

export function writeReviewDraft(key: string, draft: ReviewDraft | null): void {
  try {
    if (draft) {
      localStorage.setItem(
        PREFIX + key,
        new URLSearchParams({ action: draft.action, reason: draft.reason }).toString(),
      );
    } else localStorage.removeItem(PREFIX + key);
  } catch {
    // Draft persistence is a convenience; browser storage may be disabled.
  }
}
