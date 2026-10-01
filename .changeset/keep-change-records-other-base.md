---
"@aurelienbbn/agentlint": patch
---

`check --all`, `next`, and `acceptances clean` against a merge base other than the default branch's no longer remove change-rule acceptances and proposals. Such a check sees a change finding only relative to its own base, so it could not tell the finding was gone: a check against a parent branch removed acceptances recorded against `origin/main`, and the next check against `origin/main` reopened them. Stale state records still go on any complete check, and stale change records on a complete check against the default branch (`origin/HEAD`, else `origin/main`, `main`, `origin/master`, `master`), however `--base` or config `base` spells it. Scripts that snapshot and restore `.agentlint/acceptances.jsonl` and `proposals.jsonl` around a narrower-base check can go.
