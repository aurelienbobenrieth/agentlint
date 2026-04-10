#!/usr/bin/env bash
set -euo pipefail
pnpm changeset version
node scripts/sync-skill-version.mjs
