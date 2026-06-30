---
name: agentlint/usage
description: >
  Run agentlint after code changes and resolve every finding through the v0
  guidance and ledger loop. Activate before completion, before commits, or when
  the developer asks to scan code with agentlint.
type: core
library: agentlint
library_version: "0.1.5"
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
3. Use the finding message, standard, and checks from `check` as the normal action guidance.
4. Run `<agentlint-cmd> explain <selector>` when you need examples, refs, ledger context, or boundary-case calibration.
5. Run `<agentlint-cmd> explain <rule-id>` once when multiple findings share a rule and the first one needs detailed guidance.
6. Use latest-check selectors such as `1` or `[1]`; rerun `check` if a selector is stale.
7. Never accept a finding without understanding the rule guidance and the local code.
8. Stop only after `<agentlint-cmd> check` reports no unresolved blocking findings.

Commands:

```bash
<agentlint-cmd> check
<agentlint-cmd> check --format jsonl
<agentlint-cmd> explain 1
<agentlint-cmd> resolve 1 --accept --reason "..."
<agentlint-cmd> resolve 1 --defer --reason "..."
<agentlint-cmd> resolve 1 --no-fix --reason "..."
<agentlint-cmd> ledger list
<agentlint-cmd> ledger gc
```

Use `<agentlint-cmd> rules list` to see configured rule ids and compact standards. Use `<agentlint-cmd> rules list --files path/to/file.tsx` to see file-specific enablement.

Guidance shape:

- `standard` and `checks` are normal `check` feedback and should be enough for straightforward fixes.
- `examples` calibrate edge cases and acceptable fixes; load them through `explain`.
- `refs` identify the source of truth for rules tied to external docs or platform contracts; load them through `explain` when verifying current authority.

When stuck on a weird, repeated, dependency-specific, or platform-specific issue, search `.agents/learn/` with `rg` before rediscovering the same fix. Write a short learned note only after non-obvious investigation that would plausibly save a future session.
