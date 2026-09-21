---
"@aurelienbbn/agentlint": minor
---

Add `agentlint pr <number>`: download the `agentlint-review-<number>` artifact the GitHub action uploaded through the `gh` CLI and open it in the detached review UI (`--artifact-only` prints the extracted path instead). The config loader now resolves `@aurelienbbn/agentlint` and its `/testing` and `/contract` subpaths to the running copy of the package, so `npx --yes @aurelienbbn/agentlint check` works in a repository that never installed it.
