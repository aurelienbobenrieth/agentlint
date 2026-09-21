---
"@aurelienbbn/agentlint": minor
---

Make the gate binary: a current finding is accepted or unresolved. `.agentlint/acceptances.jsonl` stores only current acceptances and replaces the 0.1 event ledger and its deferred, no-fix, and approval states. An acceptance opens a gate only when standard revision, detector version, binding digest, versioned fingerprint, and authority all match. State fingerprints survive formatting-only edits and line moves; material changes invalidate them. Lineage can show a prior reason but never opens a gate. Complete scans remove dead records; partial scans preserve unexamined ones.
