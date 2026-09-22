---
"@aurelienbbn/agentlint": patch
---

Harden repository reliability: fixture tests now replay detectors to catch nondeterministic findings, persistence locks
are ownership-safe and fail closed, the Git adapter is isolated behind folder-contained modules, and CI enforces the
production dependency graph. Published artifacts are checked with publint and Are the Types Wrong. The composite Action
no longer relies on undeclared workspace runtime dependencies. Browser and cross-process smoke tests now exercise the
review UI and persistence lock at their real runtime boundaries.
