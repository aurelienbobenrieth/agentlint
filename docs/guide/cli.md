# CLI reference

**Every command exits `0`, `1`, or `2`, with identical local and CI semantics. Every command accepts `--help`.**

```text
agentlint check [files...] [--all] [--base ref] [--rule id]
                [--format text|jsonl] [--review-output path]
agentlint next [--base ref] [--rule id] [--format text|json]
agentlint accept <selector> --reason "..." [--base ref]
agentlint approve <selector> --reason "..." [--base ref]
agentlint propose <selector> --summary "..." [--diff-file path] [--base ref]
agentlint explain <rule-id|selector>
agentlint review [--base ref] [--mode review|calibration] [--from artifact]
                 [--port number] [--no-open]
agentlint pr <number> [--repo owner/name] [--artifact-only] [--port number] [--no-open]
agentlint rules list [--files path]
agentlint rules test [--rule id]
agentlint rules scan [files...] [--rule id] [--base ref] [--review]
agentlint rules calibration <reports...> [--format text|json]
agentlint acceptances list
agentlint acceptances clean [--base ref]
agentlint acceptances import <decisions.jsonl> [--base ref]
agentlint outcomes record <selector> --kind <kind> --reference "..." --note "..." [--base ref]
agentlint outcomes list [--format text|json]
agentlint init [--preset package#export]
```

## Exit codes

| Exit | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| `0`  | Every current finding has a compatible acceptance         |
| `1`  | One or more findings are unresolved                       |
| `2`  | Invalid usage, configuration, or evidence; internal error |

Every command exits `2`, never `1`, on an internal error.

## What each command is for

| Command                 | Does                                                                                            | Guide                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `check`                 | Runs the gate on changed files plus all change rules; exits `1` while any finding is unresolved | [Acceptance](acceptance.md)                                                        |
| `check --all`           | Complete state scan and safe stale cleanup                                                      | [Acceptance](acceptance.md#complete-scans-remove-dead-acceptances)                 |
| `check --review-output` | Writes a detached review artifact                                                               | [Review](review.md#detached-ci-review-keeps-the-gate-closed-until-you-import)      |
| `next`                  | Returns one current obligation with evidence, authority, and argument arrays                    | [Acceptance](acceptance.md#next-hands-the-agent-one-finding-at-a-time)             |
| `accept` / `approve`    | Records an acceptance with a reason; `approve` is the explicit human entry point                | [Acceptance](acceptance.md)                                                        |
| `propose`               | Attaches agent work to a finding it can't accept                                                | [Acceptance](acceptance.md#an-agent-proposes-a-human-ratifies)                     |
| `explain`               | Shows the standard and guidance behind a rule or finding                                        |                                                                                    |
| `review`                | Opens the local review UI; `--from` opens a detached artifact                                   | [Review](review.md)                                                                |
| `pr`                    | Opens the review artifact the GitHub action uploaded for a pull request, via the `gh` CLI       | [Review](review.md)                                                                |
| `rules list`            | Lists configured rules; `--files` shows only rules whose scope matches that path                | [Writing rules](writing-rules.md)                                                  |
| `rules test`            | Runs every rule against its fixtures                                                            | [Writing rules](writing-rules.md#fixtures-prove-activation-and-protect-boundaries) |
| `rules scan`            | Runs rules without the gate; `--review` opens calibration                                       | [Calibration](calibration.md)                                                      |
| `rules calibration`     | Combines exported calibration reports; later reports replace labels for the same evidence       | [Calibration](calibration.md)                                                      |
| `acceptances …`         | Lists, cleans, or imports acceptances                                                           | [Acceptance](acceptance.md)                                                        |
| `outcomes …`            | Records and summarizes delayed outcomes                                                         | [Calibration](calibration.md#record-what-happened-later)                           |
| `init`                  | Creates `.agentlint/config.ts`; `--preset` composes plugin presets                              | [Get started](getting-started.md)                                                  |

## Flags and arguments

| Input            | Meaning                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `<selector>`     | A finding number from the last `check`, or a full finding key                                                                   |
| `--rule`         | Restricts to a rule id; repeat or comma-separate for several. Narrowed scans are partial.                                       |
| `--base <ref>`   | Change evidence base. Without it, agentlint detects an upstream or conventional main branch and fails clearly if none is valid. |
| `[files...]`     | Files or directories; directories expand recursively. Explicit files make the scan partial.                                     |
| `--port`         | Local server port; `0` (default) picks a free port                                                                              |
| `--no-open`      | Print the URL instead of opening the browser                                                                                    |
| `--format jsonl` | One JSON record per line from `check`                                                                                           |

`.agentlint/.cache/` maps run-local finding numbers such as `1` back to full finding identities. It is disposable and must not be committed.
