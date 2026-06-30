---
"@aurelienbbn/agentlint": major
---

Replace the reviewed-flag workflow with the v0 finding, guidance, and ledger loop.

Breaking changes:

- Rule definitions now use `id`, `description`, `guidance`, and `createOnce(context)` with `context.report(...)`.
- Config owns `files`, `ignores`, `overrides`, `policy`, and `extends`; rule-level `meta`, `languages`, `include`, `ignore`, and `instruction` are removed.
- `agentlint review` and `agentlint list` are replaced by `agentlint resolve`, `agentlint rules list`, and `agentlint ledger`.
- `.agentlint-state` is removed. Explicit dispositions are written to committed `.agentlint/ledger.jsonl`; latest-check selector cache lives under gitignored `.agentlint/.cache/`.
- `agentlint check` now supports `--format jsonl` and disposition-aware local versus CI gating.
- `agentlint check` now includes short guidance checks in text and JSONL output; examples and refs remain available through `agentlint explain`.
- The package exports the new rule/config/guidance/finding APIs plus the first internal presets and rules.

Also updates `agentlint init`, README, contributor guidance, and packaged skills for the new workflow.
