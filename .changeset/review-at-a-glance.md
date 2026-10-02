---
"@aurelienbbn/agentlint": minor
---

The review UI answers three questions above the code: why the finding was flagged, what the reviewer decides, and what the agent proposes. Files to review together move to a side tree that switches the code panel. A change finding shows its diff, and a change finding that names no lines no longer highlights line 1. The finish screen reads "4 accepted · 1 sent back for changes".

The review payload and detached artifact move to version 4: they carry the diffs of changed files, and `code.focus` is `null` for a finding about a whole file. An artifact written by an earlier version must be regenerated. The usage skill now gives `propose --summary` a fixed shape.
