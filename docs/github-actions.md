# GitHub Actions

CI is the authoritative agentlint gate. Hooks and MCP shorten feedback distance, but `check --ci` is what protects the merge.

```yaml
name: agentlint

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: agentlint-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx agentlint rules test
      - run: npx agentlint check --all --ci
```

`--ci` blocks unresolved, deferred, and approval-requested findings. An ordinary local check allows deferred work and pending human approval so an agent can finish its turn.

## Review ledger changes

Produce a reviewer-facing summary with:

```bash
npx agentlint ledger review --base "origin/${{ github.base_ref }}"
```

The repository workflow posts a sticky PR comment for same-repository branches. Fork pull requests receive the same report in the workflow job summary because GitHub correctly removes comment-write permission from forked code.

## Release safety

For libraries, build and pack before publishing, install the tarball into a clean temporary project, and publish that exact tested tarball. agentlint's own CI follows this flow through `scripts/smoke-package.mjs`.
