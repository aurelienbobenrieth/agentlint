---
name: usage
description: >
  Run the repository's agentlint gate after code changes, apply its standards,
  and finish only after every current finding is fixed or validly accepted.
metadata:
  type: core
  library: agentlint
  library_version: "0.1.5"
sources:
  - "aurelienbobenrieth/agentlint:packages/agentlint/README.md"
  - "aurelienbobenrieth/agentlint:packages/agentlint/src/bin.ts"
---

# agentlint usage

Resolve `<agentlint-cmd>` from the repository package manager: `pnpm agentlint`, `npm exec agentlint --`, `yarn agentlint`, or `bun run agentlint`.

1. Run `<agentlint-cmd> check` after a coherent change and `check --all` at a completion checkpoint.
2. Treat every unresolved finding as mandatory work. Read its standard and inspect `<agentlint-cmd> explain <selector>` when the compact output is insufficient.
3. Prefer changing the evidence so the standard is clearly satisfied.
4. For an `agent` authority finding that is already permitted, run `<agentlint-cmd> accept <selector> --reason "..."` with the concrete fact that satisfies the standard. Do not use a generic reason.
5. Never create human authority. For a `human` finding, do the work you can, then run `<agentlint-cmd> propose <selector> --summary "..." [--diff-file path]` so the reviewer sees your change or your reason for not changing it next to the evidence. Then ask the user to run the review UI or `approve` command.
6. A prior lineage reason is context only. Re-evaluate the changed evidence; do not assume the old acceptance still applies.
7. Check the reported scope. An open partial scan covers only that scope. A complete checkpoint must inspect every configured obligation. Resolve evidence-read and configuration failures before judging the gate.
8. Rerun the gate after changes or acceptance. Stop only when the applicable check reports the gate open.

Useful commands:

```bash
<agentlint-cmd> check
<agentlint-cmd> check --all
<agentlint-cmd> check --format jsonl
<agentlint-cmd> explain 1
<agentlint-cmd> accept 1 --reason "..."
<agentlint-cmd> rules list
<agentlint-cmd> rules test
<agentlint-cmd> acceptances list
```

- When the work is on a pull request that runs the agentlint GitHub action, `<agentlint-cmd> pr <number>` downloads the review artifact and opens it. Never post `/agentlint approve` yourself; it is a human command.

The local and CI gates are equal. `--all` changes state scan completeness, not strictness. The review UI is a human connector; an agent should not invoke `approve` or import a fabricated detached acceptance.

Acceptance records attribute a declared decision and its reason to exact evidence. They do not authenticate local identity or prove the judgment correct. When a prior decision becomes incompatible, inspect the reported compatibility changes and the actual supporting code. Version 1 fingerprints require new review.
