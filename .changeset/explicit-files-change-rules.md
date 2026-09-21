---
"@aurelienbbn/agentlint": patch
---

Apply change rules to explicit `check` files in every path form the state resolver accepts. `check migrations`, `check ./migrations/1.sql`, a backslash path, or an absolute path previously matched no changed file, skipped every change rule, and reported an open gate for that scope. `init` now fails on an unreadable `.gitignore` instead of replacing it, the `pr` artifact reader caps inflated entries at 256 MiB, and the GitHub action treats a pull request whose head repository is unknown as a fork.
