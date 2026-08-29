#!/usr/bin/env bash
set -euo pipefail
pnpm changeset version
node packages/agentlint/scripts/sync-versions.mjs
