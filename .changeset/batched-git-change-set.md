---
"@aurelienbbn/agentlint": patch
---

`check` and `review` read a branch's changes with a constant number of Git processes instead of three per changed file: one `cat-file --batch` for the baseline side and one `git diff` per command-line-sized run of paths. On a branch changing about 440 files, `check --all` fell from about 15 s to under 8 s on Windows, where each Git process costs the most. Findings and their fingerprints are unchanged; an equivalence test runs the previous implementation beside the new one over every kind of change. Fingerprint digests also skip Effect Schema's per-string encoder, which produced the same JSON, and a file's structure is digested once for all the rules that report in it.
