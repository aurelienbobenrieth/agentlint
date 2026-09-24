---
"@aurelienbbn/agentlint": minor
---

Update the package, its dependencies, and its skills.

- Depend on Effect `4.0.0-rc.115`. `effect`, `@effect/platform-node`, and `@effect/platform-node-shared` are pinned together so npm and yarn install a single copy.
- Ship the changelog and third-party notices in the package.
- Publish through npm trusted publishing from a protected GitHub environment.
- Add a `setup` skill that installs agentlint in a repository. It covers verified rule-package presets, gradual adoption, and a Claude Code and Codex Stop hook script (`agentlint-gate.mjs`) over the CLI exit code. Update the `usage` and `rule-advisor` skills to the 0.2 model.
