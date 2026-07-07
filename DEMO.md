# agentlint in 10 minutes

A guided tour of the whole loop using [examples/demo](examples/demo): findings,
dispositions, a human-gated rule, the review UI, and the CI gate.

Prerequisites: `pnpm install && pnpm build` at the repo root, then:

```bash
cd examples/demo
```

## 1. See the findings

```bash
pnpm agentlint check --all
```

Three findings on `src/app.tsx`:

- `data/bounded-query` — the `useQuery` has no bound (agent-resolvable),
- `ui/query-state-coverage` — no loading/error/empty states (agent-resolvable),
- `danger/lossy-migration` — `db.dropTable(...)` (human-gated: no `--accept` offered, only `--request-approval`).

Also note the dim **Context notes** line: the learned note in
`.agents/learn/query-cache-gotcha.md` matched because a scanned file uses
`useQuery` — deterministic memory retrieval, body stays on disk.

## 2. Prove the rules are precise

```bash
pnpm agentlint rules test
```

Every rule ships inline `valid`/`invalid` fixtures — the precision proof that
strings, comments, and wrapper calls do not false-positive.

## 3. Resolve like an agent would

```bash
pnpm agentlint explain 1     # full guidance: examples, refs, ledger context
pnpm agentlint resolve 1 --accept --reason "Users list bounded by org size, max ~200 rows."
pnpm agentlint resolve 2 --accept --reason "Route-level Suspense + error boundary cover the states."
pnpm agentlint resolve 3 --accept --reason "trust me"   # refused: human-gated
pnpm agentlint resolve 3 --request-approval --reason "legacy_users fully backfilled to users_v2, verified in staging."
```

Check the semantics:

```bash
pnpm agentlint check --all        # exit 0 - the agent can finish its turn
pnpm agentlint check --all --ci   # exit 1 - nothing merges until a human approves
```

Every disposition is now a line in `.agentlint/ledger.jsonl` with your actor —
committed, reviewable, hash-pinned to the exact code it covers.

## 4. Review as the human

```bash
pnpm agentlint review
```

The browser opens on the review UI:

- **Needs action** shows the pending approval with the agent's stated reason
  pre-filled on Approve.
- Toggle **examples/refs** on any card — the same incremental disclosure agents
  get through `explain`.
- Try **Request changes** with a comment, then **Finish review**: the comment
  lands in `.agentlint/review-feedback.md` *and* in the terminal that launched
  the review — that is the feedback loop back to the agent.
- Or **Approve**: `check --ci` now exits 0. Edit the `dropTable` line afterwards
  and the approval invalidates automatically (hash-pinned).

CLI equivalents: `pnpm agentlint approve 1 --reason "..."` (refused for agent
actors) and `pnpm agentlint ledger review --base main` (the PR surface).

## 5. Reset the playground

```bash
git checkout -- examples/demo && git clean -fd examples/demo
```

## Where to look next

- Repo dogfooding: [.agentlint/config.ts](.agentlint/config.ts) enforces
  AGENTS.md conventions on agentlint's own source, gated in CI.
- Harness integrations: `agentlint init --harness claude-code` (PostToolUse
  hook), `agentlint mcp` (MCP server), `agentlint hook claude-code`.
- PR surface: the `ledger-review` workflow comments new dispositions and
  pending approvals on every PR.
