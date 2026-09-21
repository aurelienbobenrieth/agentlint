# Security model

This document records the security boundaries that are precise enough to drift with the implementation. [`SECURITY.md`](../SECURITY.md) covers supported versions and private vulnerability reporting.

## Local engine

The deterministic engine reads the repository, runs repository-selected detectors in-process, and writes to `.agentlint/`. It makes no network requests and calls no model. Optional pull-request integrations contact GitHub.

Rules are executable code because `.agentlint/config.ts` is loaded and evaluated. Treat untrusted pull-request configuration like any other untrusted dependency: run it on an isolated runner without secrets or a write token. The bundled action rejects `pull_request_target`.

Authority records accountability, not cryptographic identity. Any process with repository write access can edit the configuration and acceptance store. Git review is the intended control.

## Local review server

`agentlint review` binds to `127.0.0.1` and advertises `http://127.0.0.1:<port>`. It accepts only requests whose `Host` is `127.0.0.1:<port>` or `localhost:<port>`. The static SPA shell remains visible to other processes on the same machine.

The advertised URL contains a single-use token. Its first use sets an `HttpOnly`, `SameSite=Strict` cookie named after the port and containing a different random session secret. Reusing the link without that cookie is refused. Until first use, the link token is visible in the terminal and in the browser launcher's arguments.

Every `/api/*` request requires the session cookie. Mutations also require a loopback `Origin` and, when they contain a body, `application/json`. State reads are refused when the browser identifies them as cross-site or same-site. Request bodies are capped at 128 KiB. Unexpected failures are logged to the terminal and returned as a fixed public error.

Editor targets must resolve inside the repository. Launchers are limited to registered URL schemes or commands discovered on `PATH` whose resolved executable is outside the reviewed repository.

## Detached artifacts

Detached review artifacts contain full source files, findings, standards, and recorded reasons. Source and reasons can contain secrets. Apply the repository's confidentiality and retention policy; generated artifacts are not sanitized.
