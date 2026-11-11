#!/usr/bin/env bash
set -euo pipefail
pnpm changeset version
node packages/agentlint/scripts/sync-versions.mjs
# A version of another length shifts the Markdown tables the sync rewrites.
pnpm fmt
