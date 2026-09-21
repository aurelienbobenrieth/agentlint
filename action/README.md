# agentlint GitHub Action

Runs the [agentlint](../packages/agentlint/README.md) gate on a pull request and puts the result where the reviewer already is:

- a check run named **`agentlint`** on the head commit (the gate: `success`, `failure`, or `action_required`), with one annotation per finding;
- one sticky summary comment on the pull request, edited in place on every run;
- one inline review comment per finding that sits inside the pull request diff, resolved automatically once the finding is accepted or disappears;
- `/agentlint approve ...` commands that record a human acceptance, commit it as the approver, push, and re-run the gate.

The action is a composite action implemented with Node scripts, Effect, the global `fetch`, and `git`. The agentlint CLI itself is fetched with `npx` from the version you pin, or run from a checkout you built.

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
      - name: Checkout pull request
        uses: actions/checkout@v5
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: Set up Node
        uses: actions/setup-node@v5
        with:
          node-version: 22
      - name: Run the agentlint gate
        uses: aurelienbobenrieth/agentlint/action@v0.1.5
        with:
          version: "0.1.5"
          install: "true"

  command:
    if: >-
      (github.event_name == 'issue_comment' && github.event.issue.pull_request && startsWith(github.event.comment.body, '/agentlint'))
      || (github.event_name == 'pull_request_review_comment' && startsWith(github.event.comment.body, '/agentlint'))
    # On the job, behind the `if`: a comment that is not a command never enters the group.
    concurrency:
      group: agentlint-command-${{ github.event.issue.number || github.event.pull_request.number }}
      cancel-in-progress: false
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      checks: write
    steps:
      - name: Checkout command target
        uses: actions/checkout@v5
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: Set up command runtime
        uses: actions/setup-node@v5
        with:
          node-version: 22
      - name: Apply the agentlint command
        uses: aurelienbobenrieth/agentlint/action@v0.1.5
        with:
          version: "0.1.5"
          install: "true"
```

`fetch-depth: 0` matters: change rules diff against the merge base with `origin/<base>`.

Neither job persists the checkout credentials. The install and the agentlint CLI run repository code (lifecycle scripts, `.agentlint/config.ts`), so the action starts them, and every `git` command, without the `github-token` input, `GITHUB_TOKEN`, `GH_TOKEN`, the `ACTIONS_*` runtime and OIDC variables, `NODE_AUTH_TOKEN`, `NPM_TOKEN`, or any `INPUT_*` variable. The token is used for GitHub API calls from the action's own process, and for the fetches and the approval push, where it is passed to that one `git` command as an HTTP header and never written to `.git/config`. Do not put other secrets in the `env` of these jobs: only the names above are removed.

Then **mark the `agentlint` check as required** in the branch protection rules or the ruleset of the base branch. The check run is the gate; the workflow's own conclusion is not. Read [Fork pull requests](#fork-pull-requests) first if the repository accepts them.

### Concurrent commands

GitHub keeps one running and one pending run per concurrency group, and a newer pending run cancels the older pending one. A group at workflow level would therefore drop approvals: every comment on the pull request enters it, and three quick `/agentlint approve` replies leave one running, one pending, and one cancelled. The group above is on the `command` job, behind its `if`, so only commands enter it, and it is there to save runner time, not for correctness: when the branch moved between the fetch and the push, the action fetches the new head, records the approval again there, and pushes again, up to three times, never with force. With the group in place a burst of more than two commands can still lose the middle ones to the same GitHub rule; the commenter sees no rocket reaction and sends the command again. Remove the `concurrency` block if that matters more than runner time.

## Inputs

| Input               | Default                  | Meaning                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | `0.1.5`                  | `@aurelienbbn/agentlint` version to run through `npx --yes`, or `file:<path>` to run `<path>/dist/bin.mjs` from a checkout you built (path from the workspace root). When the repository installed its own copy (`install: true`), that copy runs instead, with a warning if its version differs. |
| `base`              | `${{ github.base_ref }}` | Base branch, slashes included (`release/1.x`). The action passes `origin/<base>` to `--base`, fetching it if the checkout does not have it. `HEAD`, `origin/...`, and `refs/...` are passed as is.                                                                                                |
| `working-directory` | `.`                      | Directory that holds `.agentlint/config.ts`.                                                                                                                                                                                                                                                      |
| `install`           | `false`                  | Run the repository install first: `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`, `yarn install --immutable`, or `npm ci`, chosen from the lockfile in the working directory, then the workspace.                                                                              |
| `github-token`      | `${{ github.token }}`    | Token for the check run, the comments, the fetches, and the approval push. See [The approval push](#the-approval-push).                                                                                                                                                                           |
| `comment`           | `true`                   | Post the sticky summary and the inline review comments. `false` keeps only the check run.                                                                                                                                                                                                         |
| `dry-run`           | `false`                  | Read everything, write nothing. Every planned write is printed and returned in `dry-run-plan`.                                                                                                                                                                                                    |

## Outputs

| Output         | Meaning                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `gate`         | `open`, `closed`, or `error` (CLI exit code 0, 1, or 2).                                                                            |
| `unresolved`   | Number of unresolved findings.                                                                                                      |
| `human`        | Number of unresolved findings that need human authority.                                                                            |
| `artifact`     | Absolute path of the detached review artifact, uploaded as `agentlint-review-<pr>`. Open it locally with `agentlint review --from`. |
| `dry-run-plan` | JSON array of `{ method, url, body }` for every write a dry run would have made.                                                    |

The main step exits with the gate code on `pull_request` (0, 1, or 2), so the job fails while the gate is closed. Command runs exit 0 when the command was answered, including a refusal, and non-zero when the action failed or the approval could not be pushed.

## Commands

Only members with `write`, `maintain`, or `admin` permission can run commands, and only from a user account. Anyone else gets a thumbs down and a reply. Commands on fork pull requests are refused: the token cannot push to the fork.

| Where                                | Command                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull request conversation            | `/agentlint approve <digest> --reason "why it satisfies the standard"` where `<digest>` is at least 7 hex characters of the fingerprint, or `path:line` (see below). |
| Reply to an agentlint inline comment | `/agentlint approve <reason>`; the finding is the one in the thread.                                                                                                 |
| Anywhere on the pull request         | `/agentlint check` re-runs the gate.                                                                                                                                 |

An approval runs `agentlint approve` with `AGENTLINT_ACTOR=human:<login>`, commits `.agentlint/acceptances.jsonl` with the approver as author and `github-actions[bot]` as committer (`chore(agentlint): accept <rule> at <file>:<line>`, trailer `Approved-by: @<login>`), pushes to the pull request branch, re-runs the gate on the new head, updates the check run and the summary, resolves the inline thread, and reacts with a rocket. Reasons are trimmed to 1000 characters. Agent-authority findings are accepted locally with `agentlint accept` and pushed; the action does not accept on the agent's behalf.

A digest names one finding and its evidence, and so does a reply on an inline comment. `path:line` names whatever finding is on that line when the queued job runs, so it is accepted only while the pull request head is still the commit in the `Head` of the action's latest summary comment. After a push in between, the command is refused and the reply asks for the digest. The action reads markers and summaries only from comments posted by the account its own token acts as (`github-actions[bot]` for the default token); a marker quoted by anyone else, another bot included, is ignored.

### The approval push

The push authenticates with `github-token`, which needs `contents: write`. With the default `GITHUB_TOKEN`, GitHub does not start workflows for the pushed commit: the `command` job itself re-runs the gate and publishes the `agentlint` check run on the new head, but **other required checks will not run on the approval commit**, and the pull request waits for them until someone pushes again. Pass a GitHub App installation token or a fine-grained personal access token as `github-token` if the base branch requires other checks. Comments and the check run are then posted by that account.

When the push is refused (branch rules, a token without `contents: write`), or the branch keeps moving for three attempts, the action replies to the commenter with Git's message and the run fails. Nothing is recorded in that case.

## Fork pull requests

**A fork pull request never gets the `agentlint` check run.** GitHub gives `pull_request` runs from a fork a read-only token, so the action cannot write a check run or a comment there. It still runs the gate and uploads the artifact, prints the findings as workflow annotations (`::error` for human findings, `::warning` for agent findings), says so in the log and the step summary, and exits with the gate code. `/agentlint` commands on a fork pull request are refused.

Two consequences when the `agentlint` check is required:

- A fork pull request cannot be merged as it is: the required check never reports.
- **Do not require the `gate` job's status instead.** On a fork pull request that status is computed from the fork's own `.agentlint/config.ts` and `.agentlint/acceptances.jsonl`: the contributor can delete a binding or add an acceptance, and the job turns green. It is information for the contributor, not a gate. `pull_request_target` is not a way around this either; the action rejects it, because it would run the fork's configuration with a write token.

The supported path: a maintainer reviews the fork's commits, including any change under `.agentlint/`, pushes them to a branch in this repository (`gh pr checkout <number>`, then `git push origin HEAD:refs/heads/<branch>`), and opens the pull request from that branch. The normal flow then applies: check run, comments, and `/agentlint approve`.

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

HTTP requests have a 30-second deadline. Subprocesses have a five-minute deadline. REST and review-thread pagination reject repeated cursors/pages and stop with an error above 1,000 pages; REST pagination must retain the API origin. Incomplete pagination is never returned as a successful partial inventory.

The action rejects `pull_request_target`: checking a repository executes its configuration and detectors. Untrusted pull requests need an isolated runner without secrets or a write token. A privileged follow-up job must not execute untrusted repository code. The `command` job runs the code of same-repository branches (a bot's branch, an agent's branch) and holds `contents: write`, which is why the action keeps every credential out of the install, the CLI, and `git`, and why the job should carry no other secret. Detached artifacts include full source files with findings and review reasons; restrict their audience and retention like the repository itself. See [the security model](../SECURITY.md).
