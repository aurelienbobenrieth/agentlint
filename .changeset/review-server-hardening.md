---
"@aurelienbbn/agentlint": patch
---

Harden the local review server.

The advertised URL is now `http://127.0.0.1:<port>` and carries a single-use token. Its first use sets a session cookie named after the port with a different secret, so concurrent review sessions no longer sign each other out and a reused link is refused. Requests must name `127.0.0.1:<port>` or `localhost:<port>` as `Host`, action and open requests must be `application/json`, and cross-site state reads are refused.

A malformed request target no longer ends the CLI process. Malformed bodies answer 400, bodies over 128 KiB answer 413, and unexpected failures answer a fixed message while the detail goes to the terminal.

Withdrawing a decision or requesting changes revokes only the acceptance the session was last shown. One recorded since then by another tab or by `agentlint approve` is kept and the action answers 409. Finishing or interrupting a review waits for actions still writing to `.agentlint/`.

On Windows, editor launchers are looked up on `PATH` only, and on every platform a launcher inside the reviewed repository is ignored. Opening a finding in an editor no longer rebuilds the whole review payload.
