import type { ReviewMode } from "@aurelienbbn/agentlint/contract";
import type { AuthorityFacet, LifecycleFacet, StatusFacet } from "../../model";

export const statusLabel = (status: StatusFacet, mode: ReviewMode): string =>
  status === "accepted"
    ? mode === "calibration"
      ? "Labeled"
      : "Accepted"
    : status === "changes_requested"
      ? "Changes requested"
      : "Open";

export const lifecycleLabel = (lifecycle: LifecycleFacet): string =>
  lifecycle === "change" ? "Introduced by this change" : "Current code";

export const authorityLabel = (authority: AuthorityFacet): string =>
  authority === "human" ? "Human decision" : "Agent may decide";

export const relativeTime = (iso: string, nowIso: string): string => {
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return iso;
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const safeExternalHref = (href: string | null): string | null => {
  if (href === null) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

export const actorLabel = (actor: string): string => actor.replace(/^(agent|human):/u, "");
export const actorKind = (actor: string): "agent" | "human" => (actor.startsWith("agent") ? "agent" : "human");
