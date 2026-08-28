# GitHub Actions

CI runs the same binary gate as local development. There is no CI-only severity model: every current finding must disappear or have an exact compatible acceptance.

```yaml
name: agentlint

on:
  pull_request:

permissions:
  contents: read

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm agentlint rules test
      - run: pnpm agentlint check --all --base "origin/${{ github.base_ref }}" --review-output artifacts/agentlint-review.json
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: agentlint-review
          path: artifacts/agentlint-review.json
```

`fetch-depth: 0` is required because change rules use the merge base. The artifact step is safe on untrusted pull requests: it uploads repository-derived review data and does not require write permissions, secrets, a bot, or a waiting browser.

After downloading an artifact:

```bash
pnpm agentlint review --from agentlint-review.json
```

Detached review can export change requests and human acceptance JSONL. Commit reviewed acceptances through:

```bash
pnpm agentlint acceptances import agentlint-acceptances.jsonl --base origin/main
pnpm agentlint check --all --base origin/main
```

Import is deliberately not a blind file copy. It recomputes current findings and rejects stale or incompatible decisions.

## Local speed

Use `agentlint check` during development to inspect changed state files and all configured change rules. Use `agentlint check --all` at a refactor checkpoint and in CI. Both have identical acceptance and exit semantics; only their state-rule scan scope differs.

## Provider review

GitHub comments, CODEOWNERS, signed receipts, and protected-environment approval are future adapters. They belong outside the core until they can add verifiable authority without weakening the local workflow. The current artifact is intentionally provider-neutral.
