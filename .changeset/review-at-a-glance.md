---
"@aurelienbbn/agentlint": minor
---

The review UI leads each finding with the rule's message, what to check before accepting, and the agent's proposal, signed with the agent's mark (Claude, OpenAI, Gemini, Grok and others). Files to review together move to a resizable, foldable pane on the right that switches the code panel; `]` toggles it and ⌘/Ctrl+← and → fold or unfold every folder. A change finding shows its diff, and a change finding that names no lines no longer highlights line 1. The finish screen reads "4 accepted · 1 sent back for changes".

The review payload and detached artifact move to version 4: they carry the diffs of changed files, and `code.focus` is `null` for a finding about a whole file. An artifact written by an earlier version must be regenerated. The usage skill now gives `propose --summary` a fixed shape.
