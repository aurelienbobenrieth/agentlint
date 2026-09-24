---
"@aurelienbbn/agentlint": minor
---

Add a reusable GitHub action (`aurelienbobenrieth/agentlint/action`). It runs the gate on pull requests and reports it as a check run, a sticky summary comment, and inline review comments. It records human approvals from `/agentlint approve` comments and uploads a detached review artifact for `agentlint pr`.

- The token never reaches the install, the CLI, or git hooks.
- `pull_request_target` is rejected, and markers are trusted only in comments that an application posted.
- HTTP requests, pagination, subprocesses, and annotations are bounded.
- `dry-run` prints the planned writes instead of making them.
