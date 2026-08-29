# ADR-008: GitHub action

- Status: Accepted
- Date: 2026-08-30
- Depends on: [ADR-002](./adr-002-acceptance-model.md), [ADR-003](./adr-003-application-and-integrations.md)
- Related to: [ADR-006](./adr-006-review-workflows.md)

## Decision

agentlint ships one reusable GitHub action at `action/` in this repository. Consumers reference it as `aurelienbobenrieth/agentlint/action@<tag>`.

The action is a thin adapter over the CLI. It runs the same `check` as a developer runs locally, publishes the result on the pull request, and lets a human with write access record an acceptance from the pull request.

The `agentlint` check run is the gate. A consumer marks it as a required status check.

## Context

An agent that works autonomously ends its work with a pull request. Findings with `agent` authority are resolved inside the agent loop. Findings with `human` authority wait for a person.

Before this record, the only path for that person was to download the review artifact, open it locally, export decisions, import them, and push. Each step is small. Together they are enough friction that the review does not happen.

A disposable review site per pull request was considered and rejected. It cannot write to the repository, so it removes one download and adds a deployment.

## Surface on the pull request

One run of the action produces three things.

A check run named `agentlint` on the head commit. Its conclusion follows the CLI exit code: `success` for an open gate, `failure` for unresolved findings, `action_required` for a configuration error. It carries one annotation per finding.

One sticky summary comment, edited in place on every run. It lists every finding with a link to the file and line, the authority, and the exact command that resolves it.

One inline review thread per finding that sits on a line of the pull request diff. The thread shows the standard, the agent proposal when there is one, and the prior reason after an invalidation. Findings outside the diff appear only in the summary, because GitHub accepts inline comments only on diff lines.

The action reconciles threads by finding digest. A finding that is still present keeps its thread. A finding that is accepted or gone gets one reply and its thread is resolved.

## Human authority from the pull request

A collaborator with `write`, `maintain`, or `admin` permission replies `/agentlint approve <reason>` in a finding thread, or comments `/agentlint approve <digest> --reason "..."` on the pull request.

The action runs `agentlint approve` on the pull request branch with `AGENTLINT_ACTOR=human:<login>`, commits `.agentlint/acceptances.jsonl` with the approver as author, and pushes. The commit does not start a new workflow run. The same job runs `check` once more and updates the check run, the summary, and the thread.

The gate opens when the last acceptance lands. No workflow run is repeated per approval.

Authority stays accountability, not identity. The acceptance record names the GitHub login. The push is visible in the branch history. This is the same security boundary as a local acceptance.

## Read-only pull requests

A pull request from a fork runs with a read-only token. The action prints workflow annotations, uploads the artifact, and exits with the gate code. It does not comment, does not create a check run, and refuses approval commands.

## Local agent

`agentlint pr <number>` downloads the review artifact of a pull request with the `gh` CLI and opens it in the review workspace. It is a client convenience over the artifact contract, not a bot, and it keeps the core free of GitHub credentials.

## Testing

Logic lives in plain Node modules under `action/src` and is tested with recorded event payloads and a mocked `fetch`. A `dry-run` input makes the action compute and print every write instead of sending it. This repository runs the action in dry-run mode against `examples/demo` on every pull request. A separate throwaway repository, `agentlint-playground`, consumes the action from a branch to exercise real threads, approvals, and pushes.

## Rejected alternatives

Disposable review site per pull request: It cannot write acceptances, it publishes review data, and it costs a deployment per pull request.

Approve by GitHub review: One "Approve" would accept every human finding at once, without a reason per finding.

Workflow re-run per approval: Each approval would repeat the full pipeline. The check run already carries the gate state, so one CLI scan inside the approval job is enough.

Bot review with "request changes": Some teams forbid bots from blocking merges, and a bot approval is misleading. The action never submits an approving or blocking review. The check run carries the decision.

Mandatory personal access token: The default `GITHUB_TOKEN` is enough because no workflow needs to be re-triggered.

## Reconsideration conditions

Add a GitHub App identity if a consumer needs a signed, non-repudiable acceptance rather than an accountable login.

Add a second provider adapter only when a consumer on that provider needs it. The artifact contract and the CLI stay the shared surface.

## Consequences

GitHub-specific code exists only in `action/` and in the `pr` command. The engine, the acceptance model, and the artifact contract are unchanged.

The action version is pinned to the package version and both move together at release.

## Revision history

- 2026-08-30: Accepted.
