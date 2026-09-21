# Security policy

## Reporting a vulnerability

Do not open a public issue. Report privately through [GitHub Security Advisories](https://github.com/aurelienbobenrieth/agentlint/security/advisories/new) for this repository.

Include a description, affected versions, reproduction steps or a proof of concept, and any suggested mitigation. You will get an acknowledgement as quickly as possible and a fix before public disclosure.

## Supported versions

Only the latest published minor receives fixes while agentlint is pre-1.0.

## Security model

agentlint is a local tool. It reads the repository, runs detectors in-process, and writes to `.agentlint/`. The deterministic engine makes no network requests and calls no model. Optional pull-request integrations contact GitHub. The complete trust boundaries and local review protocol are documented in the [security model](docs/security-model.md).

- **Authority is accountability, not identity.** A `human` acceptance records who accepted and why. It is not a cryptographic proof. Any process with write access to the repository can edit `.agentlint/config.ts` and `.agentlint/acceptances.jsonl`. Git review makes those edits visible, which is the intended control.
- **The review server is loopback only.** It uses a single-use link token, a separate session cookie, strict request-origin checks, bounded bodies, fixed public errors, and an allowlisted editor launcher. See the [security model](docs/security-model.md#local-review-server) for the exact protocol.
- **Detached artifacts disclose source code and review context.** They contain full source files with findings, standards, and recorded reasons. Source code and reasons can contain secrets. Apply the repository’s confidentiality policy to artifact access and retention; never assume generated artifacts are sanitized.
- **Rules are code.** `.agentlint/config.ts` is loaded and executed. Treat it like any other executable dependency. Run untrusted pull-request configuration on an isolated runner without secrets or a write token. A trusted integration job must not execute untrusted configuration with elevated permissions. The bundled action rejects `pull_request_target`.
