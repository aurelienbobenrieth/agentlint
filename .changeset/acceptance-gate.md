---
"@aurelienbbn/agentlint": minor
---

Make the gate binary: every current finding is accepted or unresolved, with the same semantics locally and in CI.

- `.agentlint/acceptances.jsonl` is committed and stores only current acceptances, each with a reason and `agent` or `human` authority. An acceptance opens the gate only when the standard revision, detector version, binding digest, versioned fingerprint, and authority all match. Lineage can show a prior reason but never opens the gate.
- State findings use `source-structure` fingerprints (version 3). They survive formatting-only edits and line moves, and a material change invalidates them. Sources are read with LF line endings, so CRLF and LF checkouts of the same commit agree. Change findings use `git-change` fingerprints (version 2).
- A complete scan (`check --all`) removes dead acceptances and proposals; a partial scan keeps records it did not examine. Store writes are atomic and guarded by a cross-process lock.
- Complete scans list files through Git (`git ls-files --cached --others --exclude-standard`), so every machine scans the same files. Outside a Git work tree the directory walk skips only `node_modules` and `.git`. Scope globs match dotfiles. Files whose real path leaves the repository or enters `.git` are never read.
- A file with incomplete or unsupported syntax fails the run after the rest of the scan instead of being skipped silently.
