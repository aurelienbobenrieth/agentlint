---
name: expo-sheet-ivs-reload
description: Opening an expo bottom sheet remounts the IVS player and reloads the stream
---

No `triggers:` frontmatter on purpose: this knowledge is too niche to deserve
a deterministic trigger, so it never auto-surfaces in `check` output. It stays
on disk for the day someone greps for it:

    rg -l "IVS" .agents/learn/

The sheet portal remounts its subtree, which tears down the IVS player's
WebGL context. Fix was to hoist the player above the portal boundary and pass
a stable ref. Cost us 50 minutes; should cost you zero.
