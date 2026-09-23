# Security policy

## Report privately, never in a public issue

Use [GitHub Security Advisories](https://github.com/aurelienbobenrieth/agentlint/security/advisories/new) for this repository. Include a description, affected versions, reproduction steps or a proof of concept, and any suggested mitigation. You get an acknowledgement as quickly as possible and a fix before public disclosure.

## Only the latest minor is supported

While agentlint is pre-1.0, only the latest published minor receives fixes.

## Four trust boundaries

agentlint is a local tool: it reads the repository, runs detectors in-process, and writes to `.agentlint/`. The deterministic engine makes no network requests and calls no model. Optional pull-request integrations contact GitHub.

| Boundary                                                  | What it means for you                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authority is accountability, not identity**             | A `human` acceptance records who accepted and why; it is not a cryptographic proof. Any process with repository write access can edit `.agentlint/config.ts` and `.agentlint/acceptances.jsonl`. Git review makes those edits visible, which is the intended control.                                                                    |
| **The review server is loopback only**                    | Single-use link token, separate session cookie, strict request-origin checks, bounded bodies, fixed public errors, allowlisted editor launcher. [Exact protocol](docs/security-model.md#local-review-server).                                                                                                                            |
| **Detached artifacts disclose source and review context** | They hold full source files with findings, standards, and recorded reasons, which can contain secrets. Apply the repository's confidentiality policy to artifact access and retention. Never assume generated artifacts are sanitized.                                                                                                   |
| **Rules are code**                                        | `.agentlint/config.ts` is loaded and executed: treat it like any executable dependency. Run untrusted pull-request configuration on an isolated runner without secrets or a write token. A trusted integration job must not execute untrusted configuration with elevated permissions. The bundled action rejects `pull_request_target`. |

Full boundaries and protocol: [security model](docs/security-model.md).
