---
"@aurelienbbn/agentlint": minor
---

Rebuild the command line on `effect/unstable/cli`.

- `--help` is generated for every command and subcommand, with descriptions for each flag and argument. `--version` / `-v` still prints the bare version.
- `--rule` may be repeated (`--rule a --rule b`); comma-separated values still work.
- Boolean flags such as `--all` no longer swallow the positional that follows them, so `agentlint check --all src/` inspects `src/` as expected.
- Usage errors (unknown subcommand, invalid `--format` or `--mode`, out-of-range `--port`, missing `<selector>` or `--reason`) print the command help with the error and exit with code 2.
- `review --no-open` is the negation of the `--open` flag, which defaults to on.
- `propose` drops the undocumented inline `--diff` flag; use `--diff-file path`.
- `acceptances import` is all-or-nothing: when any decision is rejected, only the rejection message is printed and nothing is imported.
