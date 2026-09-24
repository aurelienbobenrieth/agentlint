---
"@aurelienbbn/agentlint": minor
---

Ship a keyboard-first review application inside the package.

- `agentlint review` serves it on `127.0.0.1` behind a single-use token and a per-port session cookie. The **Queue** lists findings that need a decision, grouped by file, with the agent's proposal, related-file context, and prior lineage next to the evidence. **Decisions** lists what is accepted, by whom and when, and lets a human request a correction. Detected editors open findings at the exact position.
- `check --review-output` writes a detached artifact that `review --from` opens without a repository. Decisions are exported for `acceptances import`, which is all-or-nothing and rejects a decision whose source differs from what the reviewer saw.
- `agentlint pr <number>` downloads the review artifact that the GitHub action uploaded, through the `gh` CLI, and opens it only when the run belongs to the pull request's own head repository and branch.
- `rules scan --review` opens calibration. Exported reports use the `@aurelienbbn/agentlint/calibration` schemas and combine with `rules calibration`.
- The review wire contract is published as `@aurelienbbn/agentlint/contract`, including `NextResult` and `DetachedDecision`.
