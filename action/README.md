# agentlint GitHub Action

Runs the [agentlint](../packages/agentlint/README.md) gate on a pull request and puts the result where the reviewer already is:

- a check run named **`agentlint`** on the head commit (the gate: `success`, `failure`, or `action_required`), with one annotation per finding;
- one sticky summary comment on the pull request, edited in place on every run;
- one inline review comment per finding that sits inside the pull request diff, resolved automatically once the finding is accepted or disappears;
- `/agentlint approve ...` commands that record a human acceptance, commit it as the approver, push, and re-run the gate.

The action is a composite action with zero runtime dependencies: plain Node scripts, the global `fetch`, and `git`. The agentlint CLI itself is fetched with `npx` from the version you pin, or run from a checkout you built.

## Usage

Two jobs: one runs the gate on `pull_request`, the other handles commands from comments. They need different permissions, so keep them separate.

```yaml
name: agentlint

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

concurrency:
  group: agentlint-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: false

permissions: {}

jobs:
  gate:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - uses: aurelienbobenrieth/agentlint/action@v0.1.5
        with:
          version: "0.1.5"
          install: "true"

  command:
    if: >-
      (github.event_name == 'issue_comment' && github.event.issue.pull_request && startsWith(github.event.comment.body, '/agentlint'))
      || (github.event_name == 'pull_request_review_comment' && startsWith(github.event.comment.body, '/agentlint'))
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      checks: write
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - uses: aurelienbobenrieth/agentlint/action@v0.1.5
        with:
          version: "0.1.5"
          install: "true"
```

`fetch-depth: 0` matters: change rules diff against the merge base with `origin/<base>`. The command job keeps the checkout credentials because it pushes the acceptance commit to the pull request branch.

Then **mark the `agentlint` check as required** in the branch protection rules or the ruleset of the base branch. The check run is the gate; the workflow's own conclusion is not.

## Inputs

| Input               | Default                  | Meaning                                                                                                                                                                                                              |
| ------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | `0.1.5`                  | `@aurelienbbn/agentlint` version to run through `npx --yes`, or `file:<path>` to run `<path>/dist/bin.mjs` from a checkout you built (path from the workspace root).                                                 |
| `base`              | `${{ github.base_ref }}` | Base branch. The action passes `origin/<base>` to `--base`, fetching it if the checkout does not have it. `HEAD` or any ref containing `/` is passed as is.                                                          |
| `working-directory` | `.`                      | Directory that holds `.agentlint/config.ts`.                                                                                                                                                                         |
| `install`           | `false`                  | Run the repository install first: `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`, `yarn install --immutable`, or `npm ci`, chosen from the lockfile in the working directory, then the workspace. |
| `github-token`      | `${{ github.token }}`    | Token for the check run, the comments, and the approval push.                                                                                                                                                        |
| `comment`           | `true`                   | Post the sticky summary and the inline review comments. `false` keeps only the check run.                                                                                                                            |
| `dry-run`           | `false`                  | Read everything, write nothing. Every planned write is printed and returned in `dry-run-plan`.                                                                                                                       |

## Outputs

| Output         | Meaning                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `gate`         | `open`, `closed`, or `error` (CLI exit code 0, 1, or 2).                                                                            |
| `unresolved`   | Number of unresolved findings.                                                                                                      |
| `human`        | Number of unresolved findings that need human authority.                                                                            |
| `artifact`     | Absolute path of the detached review artifact, uploaded as `agentlint-review-<pr>`. Open it locally with `agentlint review --from`. |
| `dry-run-plan` | JSON array of `{ method, url, body }` for every write a dry run would have made.                                                    |

The main step exits with the gate code on `pull_request` (0, 1, or 2), so the job fails while the gate is closed. Command runs exit 0 unless the action itself failed.

## Commands

Only members with `write`, `maintain`, or `admin` permission can run commands, and only from a user account. Anyone else gets a thumbs down and a reply. Commands on fork pull requests are refused: the token cannot push to the fork.

| Where                                | Command                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull request conversation            | `/agentlint approve <digest> --reason "why it satisfies the standard"` where `<digest>` is at least 7 hex characters of the fingerprint, or `path:line`. |
| Reply to an agentlint inline comment | `/agentlint approve <reason>`; the finding is the one in the thread.                                                                                     |
| Anywhere on the pull request         | `/agentlint check` re-runs the gate.                                                                                                                     |

An approval runs `agentlint approve` with `AGENTLINT_ACTOR=human:<login>`, commits `.agentlint/acceptances.jsonl` with the approver as author and `github-actions[bot]` as committer (`chore(agentlint): accept <rule> at <file>:<line>`, trailer `Approved-by: @<login>`), pushes to the pull request branch, re-runs the gate on the new head, updates the check run and the summary, resolves the inline thread, and reacts with a rocket. Reasons are trimmed to 1000 characters. Agent-authority findings are accepted locally with `agentlint accept` and pushed; the action does not accept on the agent's behalf.

## Fork pull requests

On a pull request from a fork the token is read-only. The action still runs the gate and uploads the artifact, but prints findings as workflow annotations (`::error` for human findings, `::warning` for agent findings) instead of writing a check run or comments, and exits with the gate code.

## Dry run and testing the action itself

`dry-run: true` performs every read and records every write. Use it with `file:` to test an unpublished build:

```yaml
- run: pnpm install --frozen-lockfile && pnpm build
- uses: ./action
  id: smoke
  with:
    working-directory: examples/demo
    version: file:packages/agentlint
    dry-run: "true"
  continue-on-error: true
- run: test "$GATE" = closed
  env:
    GATE: ${{ steps.smoke.outputs.gate }}
```

A dry run only needs read permissions. See [`.github/workflows/action-smoke.yml`](../.github/workflows/action-smoke.yml) for the full example.

## Executable configuration and artifact confidentiality

The action rejects `pull_request_target`: checking a repository executes its configuration and detectors. Untrusted pull requests need an isolated runner without secrets or a write token. A privileged follow-up job must not execute untrusted repository code. Detached artifacts include full source files with findings and review reasons; restrict their audience and retention like the repository itself. See [the security model](../SECURITY.md).
