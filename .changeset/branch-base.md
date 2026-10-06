---
"@aurelienbbn/agentlint": minor
---

A stacked branch is judged against its parent. Without `--base`, the change base is now `AGENTLINT_BASE`, else the config's `base`, else the branch HEAD tracks (`git branch --set-upstream-to=<parent>`), else the default branch as before. A branch that tracks itself on a remote keeps the default branch. A repository whose feature branches track another local or remote branch now compares against that branch: pass `--base` or set `base` to keep the old behavior.

`agentlint base [--format json]` prints the selected ref, its merge base, and its source, so a test runner or a gate script can compare against the same commit.
