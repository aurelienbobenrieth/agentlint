---
"@aurelienbbn/agentlint": patch
---

Keep review UI decisions tied to the finding the reviewer looked at. After a decision removes the selected finding from the list, select its next neighbour instead of falling back to the top of the queue, ignore decision shortcuts until that selection settles, and never let a shortcut decide a finding that was not explicitly selected. `R` with an empty reason focuses the reason field like `A` does, and the agent handoff labels the detector message instead of presenting it as the reviewer's instruction.

Refuse a review state that repeats a finding id. Report an attached decision as saved when only the follow-up state fetch failed, and offer a reload. In attached reviews, the agent handoff and the copied finding context follow the server status instead of a stale local draft.

Warn before leaving only when a detached review holds decisions that were not downloaded or copied yet; attached reviews never prompt. Keep an unreadable saved browser review under `<key>:bak` and say so instead of dropping it, and report a failing local save once. A detached artifact no longer posts `/api/finish` to the origin that serves it, a double click on Finish sends one request, every POST declares a JSON body, and the dev proxy targets `127.0.0.1`.

Accessibility: danger toasts are announced as alerts and are never evicted by newer toasts, the finished screen and keyboard navigation move focus to the heading, closing the shortcuts dialog returns focus to its trigger, the sidebar separator is focusable and resizes with the arrow keys, and tertiary text meets 4.5:1 contrast. The lineage card shows the recorded invalidation reasons. Moving through the list no longer recomputes the sort and re-renders every group, and list order uses code-unit comparison.
