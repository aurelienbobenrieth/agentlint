---
"@aurelienbbn/agentlint": patch
---

Tighten the pull request review trust boundaries. The GitHub action reads an inline or summary marker only from a comment that an application posted, so a marker written by a commenter can no longer choose the finding that `/agentlint approve` records or suppress a real thread. `agentlint pr` opens an artifact only when its workflow run belongs to the pull request's own head repository and branch, and reports `foreign_artifact` otherwise. `gh` calls are cancellable and bounded to two minutes, the action runs `npx` without a shell on Windows, and the release script now also synchronizes skill versions, the action README, and the action's version fallback.
