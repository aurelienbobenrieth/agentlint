---
name: agentlint/usage
description: >
  Run agentlint after code changes and resolve every finding through the
  guidance, approval, and ledger loop. Activate before completion, before
  commits, or when the developer asks to scan code with agentlint.
type: core
library: agentlint
library_version: "0.2.0"
sources:
  - "aurelienbobenrieth/agentlint:README.md"
  - "aurelienbobenrieth/agentlint:src/bin.ts"
---

# agentlint

Use the repo package manager and resolve `<agentlint-cmd>` first:

- npm: `npm exec agentlint --`
- pnpm: `pnpm agentlint`
- yarn: `yarn agentlint`
- bun: `bun run agentlint`

Loop:

1. Run `<agentlint-cmd> check` after code changes; use `--all` when validating the whole repo and `--ci` for CI-equivalent gating.
2. Treat every finding as mandatory work: fix it, or record `--accept`, `--defer`, or `--no-fix` with a concrete reason.
3. Findings marked "Requires human approval" cannot be accepted by you. Fix the code, or record `--request-approval --reason "..."` explaining why the flagged code is correct. A human unblocks it later (`agentlint approve` or the review UI); pending requests do not block your local completion but do block CI.
4. Never run `agentlint approve` yourself. Approvals are reserved for humans; the ledger records the actor for every disposition.
5. Use the finding message, standard, and checks from `check` as the normal action guidance.
6. Run `<agentlint-cmd> explain <selector>` when you need examples, refs, ledger context, or boundary-case calibration.
7. Use latest-check selectors such as `1` or `[1]`; rerun `check` if a selector is stale.
8. If `.agentlint/review-feedback.md` exists, a human reviewed your work and requested changes: address each item, delete the file, and rerun `check`.
9. Dim "Context notes" lines in `check` output point to learned notes relevant to the files you touched. Read the note file when its description matches your situation.
10. Stop only after `<agentlint-cmd> check` reports no unresolved blocking findings.

Commands:

```bash
<agentlint-cmd> check
<agentlint-cmd> check --format jsonl
<agentlint-cmd> explain 1
<agentlint-cmd> resolve 1 --accept --reason "..."
<agentlint-cmd> resolve 1 --defer --reason "..."
<agentlint-cmd> resolve 1 --no-fix --reason "..."
<agentlint-cmd> resolve 1 --request-approval --reason "..."
<agentlint-cmd> ledger list
<agentlint-cmd> ledger review --base main
<agentlint-cmd> ledger gc
<agentlint-cmd> rules list
<agentlint-cmd> rules test
```

Guidance shape:

- `standard` and `checks` are normal `check` feedback and should be enough for straightforward fixes.
- `examples` calibrate edge cases and acceptable fixes; load them through `explain`.
- `refs` identify the source of truth for rules tied to external docs or platform contracts; load them through `explain` when verifying current authority.

Independent review pattern (optional, harness-level): for findings that deserve a second opinion, pass `check --format jsonl` output to a fresh session that did not author the code and let that session record dispositions with its own actor.

When stuck on a weird, repeated, dependency-specific, or platform-specific issue, search `.agents/learn/` with `rg` before rediscovering the same fix. Write a short learned note only after non-obvious investigation that would plausibly save a future session; add `triggers:` frontmatter (files globs, grep regex) so future `check` runs surface it deterministically.
