---
name: setup
description: >
  Install agentlint in a repository: create the config, select repository-owned
  rules, adopt existing findings gradually, and wire the gate into Claude Code,
  Codex, and CI so that a finished turn means an open gate.
metadata:
  type: core
  library: agentlint
  library_version: "0.3.1"
sources:
  - "aurelienbobenrieth/agentlint:packages/agentlint/README.md"
  - "aurelienbobenrieth/agentlint:packages/agentlint/src/features/init/handler.ts"
---

# agentlint setup

Resolve `<agentlint-cmd>` from the repository package manager: `pnpm agentlint`, `npm exec agentlint --`, `yarn agentlint`, or `bun run agentlint`.

Do the steps in order. Show the user each file you create or change. Do not enforce anything the user has not selected.

## 1. Install and initialize

```bash
<package-manager> add -D @aurelienbbn/agentlint
<agentlint-cmd> init
```

`init` creates `.agentlint/config.ts` and ignores the ephemeral cache. It never overwrites an existing config.

## 2. Choose the first rules

The engine ships no rules. Offer both paths and let the user choose:

- **A repeated correction.** Ask the user for one correction they have made more than once in review. Author it with the `rule-advisor` skill. This is the preferred start: one rule that the team already believes in.
- **A rule-package preset.** Use a package only when it is already present in the workspace or you have verified its exact package name, export, and compatible agentlint peer range in the configured registry. Match its documented standards to the repository instead of inferring them from a framework dependency. Do not install a package without the user's selection.

In a repository without a config, `init --preset "<package>#<preset-export>"` scaffolds the import and prints the install command. With an existing config, add the import and put the preset in `extends` yourself. Any package that exports `defineRule` values works the same way.

## 3. Adopt existing findings gradually

agentlint has no warning level. A finding is either a current obligation or not configured. Adoption is controlled by what is bound and where the gate is enforced:

1. Run `<agentlint-cmd> rules test`, then `<agentlint-cmd> rules scan --review`. A scan creates no acceptances and blocks nothing. Use the labels to fix the detector, the scope, and the guidance.
2. Report the finding count for each rule to the user. For a rule with many existing findings, choose one:
   - narrow `binding.include` to the directories the team works on now and widen it later;
   - express the concern as a `change` rule so only new changes create obligations;
   - work through the queue with `<agentlint-cmd> next --format json`, fixing or accepting each finding with its real reason.
3. Never bulk-accept findings with a generic reason to open the gate. That destroys the record the tool exists to keep.
4. Enforce last: add the hooks and mark the CI check as required only after `check --all` exits 0.

## 4. Wire the gate into the coding agent

Copy `agentlint-gate.mjs` from this skill's directory (`node_modules/@aurelienbbn/agentlint/skills/agentlint/setup/agentlint-gate.mjs`) to `.agentlint/hooks/agentlint-gate.mjs` and commit it. It runs the local CLI, maps a closed gate to exit code 2 with the findings on stderr, and lets a stop continue when `stop_hook_active` is set, so a human-authority finding interrupts once instead of looping.

Merge into an existing hook file; do not replace other hooks.

**Claude Code**: `.claude/settings.json`

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "node .agentlint/hooks/agentlint-gate.mjs stop" }] }]
  }
}
```

**Codex**: `.codex/hooks.json` (loads only when the project `.codex/` layer is trusted)

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node .agentlint/hooks/agentlint-gate.mjs stop", "timeout": 120 }] }
    ]
  }
}
```

The Stop hook runs the complete gate and returns every unresolved finding to the agent once. Harnesses mark the retry with `stop_hook_active`; the adapter then lets the turn end so a human-authority finding cannot create an infinite loop. CI remains the hard merge gate. For earlier feedback, optionally add the same command with `edit` as a `PostToolUse` hook (matcher `Edit|Write` for Claude Code, `apply_patch|Edit|Write` for Codex). It runs the partial `check` after each edit and reports without blocking. Offer it only for small rule sets; it repeats open findings after every edit.

For any other agent, add one line to `AGENTS.md`: "Run `<agentlint-cmd> check --all` before you finish; the work is complete only when it exits 0." An instruction is weaker than a hook, so the CI gate matters more there.

## 5. Enforce in CI

A local hook is feedback. The required check is the gate. Add the GitHub action from the package README, or run `<agentlint-cmd> check --all --base "origin/<base>"` in any CI, and ask the user to mark the check as required.

## 6. Confirm

Run `<agentlint-cmd> check --all`, report the result, and tell the user which files to commit: `.agentlint/config.ts`, `.agentlint/hooks/agentlint-gate.mjs`, the hook configuration, and `.agentlint/acceptances.jsonl` when it exists.
