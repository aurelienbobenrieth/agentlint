import type { StatePillTone } from "@agentlint/ui";
import { m } from "@/messages";
import type { FindingStatus, ReviewActionType } from "@/types";

export function statusLabel(status: FindingStatus): string {
  switch (status) {
    case "unresolved":
      return m.status_unresolved();
    case "pending_approval":
      return m.status_pending_approval();
    case "accepted":
      return m.status_accepted();
    case "approved":
      return m.status_approved();
    case "deferred":
      return m.status_deferred();
    case "no_fix":
      return m.status_no_fix();
  }
}

export function statusTone(status: FindingStatus): StatePillTone {
  switch (status) {
    case "unresolved":
      return "unresolved";
    case "pending_approval":
      return "pending";
    case "accepted":
      return "accepted";
    case "approved":
      return "approved";
    case "deferred":
      return "deferred";
    case "no_fix":
      return "muted";
  }
}

export function actionLabel(action: ReviewActionType): string {
  switch (action) {
    case "approve":
      return m.action_approve();
    case "accept":
      return m.action_accept();
    case "defer":
      return m.action_defer();
    case "no_fix":
      return m.action_no_fix();
    case "request_changes":
      return m.action_request_changes();
  }
}
