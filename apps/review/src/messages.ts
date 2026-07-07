/**
 * All user-facing copy for the review app.
 *
 * One module instead of string literals scattered through templates: copy
 * edits and future localization touch exactly one file. Every entry is a
 * function (parameterized where needed) so call sites stay uniform.
 */

export const m = {
  app_title: () => "agentlint review",
  app_meta: (p: { project: string; base: string }) => `${p.project} vs ${p.base}`,
  nav_review: () => "Review",
  nav_findings: () => "Findings",
  nav_ledger: () => "Ledger",
  nav_rules: () => "Rules",
  finish_review: () => "Finish review",
  loading_state: () => "Loading review state...",
  load_failed: () => "Failed to load review state. Is the agentlint review server still running?",
  finish_title: () => "Review finished",
  finish_feedback_note: (p: { path: string }) => `Change requests were written to ${p.path} for the agent.`,
  finish_close_tab: () => "You can close this tab. The agentlint process has exited.",

  status_unresolved: () => "Unresolved",
  status_pending_approval: () => "Pending approval",
  status_accepted: () => "Accepted",
  status_approved: () => "Approved",
  status_deferred: () => "Deferred",
  status_no_fix: () => "No fix",
  pill_human_gated: () => "human-gated",
  pill_durable: () => "durable",

  filter_needs_action: () => "Needs action",
  filter_pending_approval: () => "Pending approval",
  filter_unresolved: () => "Unresolved",
  filter_resolved: () => "Resolved",
  filter_all: () => "All findings",
  sidebar_status: () => "Status",
  sidebar_rules: () => "Rules",
  sidebar_housekeeping: () => "Housekeeping",
  stale_records: (p: { count: number }) => `${p.count} stale ledger record(s) - run agentlint ledger gc`,
  empty_needs_action: () => "Nothing needs your attention.",
  empty_no_match: () => "No findings match this filter.",

  action_approve: () => "Approve",
  action_accept: () => "Accept",
  action_defer: () => "Defer",
  action_no_fix: () => "No fix",
  action_request_changes: () => "Request changes",
  action_confirm: (p: { action: string }) => `Confirm ${p.action}`,
  action_cancel: () => "Cancel",
  reason_placeholder: (p: { action: string }) => `Reason for ${p.action}...`,

  guidance_show_examples: (p: { count: number }) => `Show examples (${p.count})`,
  guidance_hide_examples: () => "Hide examples",
  guidance_show_refs: (p: { count: number }) => `Show refs (${p.count})`,
  guidance_hide_refs: () => "Hide refs",
  disposition_by: (p: { status: string; actor: string; at: string }) => `${p.status} by ${p.actor} at ${p.at}`,

  ledger_only_new: (p: { base: string }) => `Only dispositions new since ${p.base}`,
  ledger_empty: () => "No ledger records.",
  ledger_empty_new: (p: { base: string }) => `No ledger records newer than ${p.base}.`,
  ledger_col_status: () => "Status",
  ledger_col_rule: () => "Rule",
  ledger_col_reason: () => "Reason",
  ledger_col_actor: () => "Actor",
  ledger_col_when: () => "When",
  ledger_tag_new: () => "NEW",

  rules_resolution: (p: { resolution: string }) => `resolution: ${p.resolution}`,
  rules_persistence: (p: { persistence: string }) => `persistence: ${p.persistence}`,
  skill_ref: (p: { id: string }) => `skill: ${p.id}`,
  theme_toggle: () => "Toggle theme",

  guided_progress: (p: { done: number; total: number }) => `${p.done} of ${p.total} reviewed`,
  guided_queue: () => "Review queue",
  guided_kbd_hint: () => "j / k to move between items",
  guided_all_done: () => "Queue clear - nothing needs your attention.",
  guided_all_done_hint: () => "New findings and agent dispositions will show up here, ordered by importance.",
  guided_mark_reviewed: () => "Mark reviewed",
  guided_reviewed: () => "Reviewed",
  guided_why_pending: () => "Blocks merge - the agent requested approval and is waiting on you.",
  guided_why_human_gate: () => "Blocks merge - human-gated rule; no agent can accept this.",
  guided_why_audit: (p: { status: string; actor: string }) =>
    `New ${p.status} by ${p.actor} since base - audit the reason.`,
  guided_why_unresolved: () => "Unresolved - agent-resolvable, weigh in if you disagree.",
  guided_section_blocking: () => "Blocking",
  guided_section_audit: () => "Audit",
  guided_section_other: () => "Other",
};
