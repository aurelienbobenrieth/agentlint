# agentlint in 10 minutes

A guided tour of the whole loop using [examples/demo](examples/demo) — a small
app you "inherit" complete with a committed ledger: some findings were already
resolved by an agent, one was approved by a human, one is deferred, and five
are waiting for you.

Prerequisites: `pnpm install && pnpm build` at the repo root, then:

```bash
cd examples/demo
```

## 1. See the findings

```bash
pnpm agentlint check --all
```

Five unresolved findings across the tree, each from a different kind of rule:

| Finding                                             | Rule                      | Shows                                   |
| --------------------------------------------------- | ------------------------- | --------------------------------------- |
| `it.only(...)` in `src/__tests__/users.test.ts`     | `tests/no-focused-tests`  | plain pattern match                     |
| `TODO` without owner in `src/pages/users-page.tsx`  | `docs/todo-needs-owner`   | `createOnce` escape hatch (comments)    |
| unbounded `useQuery` in `src/pages/users-page.tsx`  | `data/bounded-query`      | structural callee + argument inspection |
| same call, missing UI states                        | `ui/query-state-coverage` | two rules, one trigger site             |
| `db.dropTable(...)` in `src/migrations/2026-07-...` | `danger/lossy-migration`  | **human-gated**: no `--accept` offered  |

The summary line also says `4 resolved hidden; 1 deferred` — that's the
inherited history. And note the dim **Context notes**: two of the three learned notes in
`.agents/learn/` matched your files (the migrations one fires precisely on
`dropTable|dropColumn` in `src/migrations/**`).

## 2. Read the inherited ledger

```bash
pnpm agentlint ledger list
cat .agentlint/ledger.jsonl
```

Every status is represented, with actor and reason:

- **accepted** (`agent:claude`) — the `findMany` in `src/api/users.ts`, bounded by org size.
- **deferred** (`agent:claude`) — the `fetch` without timeout, waiting on a product decision. Deferred does not block you locally, but try `pnpm agentlint check --all --ci`: it blocks CI.
- **no_fix** (`agent:claude`) — `eval()` in `src/vendor/legacy-parser.js`: vendored, can't be edited, replacement planned.
- **approval_requested → approved** — the 2026-06 `dropColumn` migration: the agent requested with its evidence, `human:aurel` approved. The full trail is two lines in the ledger.

All of it is hash-pinned: edit `src/api/users.ts` line 7 and the acceptance
resurfaces as unresolved on the next check.

## 3. Rules vs notes — the same concern, two artifacts

The migration topic exists in this repo as **both** a rule and a note, on
purpose — they answer different questions:

|              | Rule (`danger/lossy-migration`)               | Note (`drop-column-backfill`)            |
| ------------ | --------------------------------------------- | ---------------------------------------- |
| Encodes      | a **standard** — "this always needs judgment" | a **fact** — "here is what we learned"   |
| Trigger      | code shape (AST pattern)                      | situation (file globs + grep)            |
| Output       | blocking finding, demands a disposition       | dim non-blocking `Context notes` pointer |
| Ledger       | every resolution is recorded and hash-pinned  | never — nothing to resolve               |
| Context cost | guidance printed with the finding             | one pointer line; the body stays on disk |

You already saw both fire on the same file in step 1: the `dropTable` finding
_blocks_, while the backfill note just points at
`.agents/learn/drop-column-backfill.md`.

Now the layered-activation part:

```bash
pnpm agentlint notes list
```

Three notes, two activation tiers:

- `drop-column-backfill` and `query-cache-gotcha` have `triggers:` frontmatter
  (globs + grep) — they surface **deterministically** whenever a scanned file
  matches.
- `expo-sheet-ivs-reload` has **no triggers** — deliberately. It is too niche
  to earn a place in anyone's context, so it never auto-surfaces; it waits on
  disk for `rg "IVS" .agents/learn/` the day the stream reloads again.

That is the whole memory model: deterministic trigger when one can be
expressed, plain search as the fallback — and never a paragraph of base
context spent either way. If a note starts feeling normative ("we should
always..."), that is the signal to promote it into a rule and let the ledger
hold people to it.

## 4. Prove the rules are precise

```bash
pnpm agentlint rules test
```

Seven rules, each shipping `valid`/`invalid` fixtures run against real parses —
strings, comments, shorthand properties, and wrapper calls don't false-positive.
Look at [.agentlint/config.ts](examples/demo/.agentlint/config.ts): it uses
code-shaped patterns (`$DB.dropTable($$$ARGS)`), a `where` constraint
(`fetch` unless a `signal` is anywhere in the args), a raw tree-sitter query
(`security/no-eval`), and one imperative visitor (TODO comments).

## 5. Resolve like an agent would

```bash
pnpm agentlint explain 8          # full guidance: examples, refs, ledger context
pnpm agentlint resolve 1 --no-fix --reason "Debug leftover; removing the .only instead." # then actually fix it
pnpm agentlint resolve 5 --accept --reason "trust me"        # refused: human-gated
pnpm agentlint resolve 5 --request-approval --reason "legacy_users fully backfilled to users_v2, verified in staging."
```

Check the semantics:

```bash
pnpm agentlint check --all        # exit 0 once the rest is fixed/resolved - the agent can finish
pnpm agentlint check --all --ci   # exit 1 - deferred + pending approval block the merge
```

## 6. Review as the human

```bash
pnpm agentlint review
```

The browser opens on the **guided review** (plannotator-style): a queue
ordered by where your attention matters - blocking items first (pending
approvals, human-gated findings), then **Audit** (dispositions agents recorded
since base, so self-acceptances get human eyes), then the rest. `j`/`k` moves
through the queue; the progress bar tracks what you have handled.

- The pending `dropTable` approval sits on top, with the agent's stated
  reason pre-filled on Approve.
- The **Ledger** tab shows the whole history — filter to "new since main" to
  see exactly what this branch added (the same delta the `ledger-review`
  GitHub Action posts on PRs).
- Toggle **examples/refs** on any card; the Findings tab keeps the filterable list view.
- Try **Request changes** with a comment, then **Finish review**: the comment
  lands in `.agentlint/review-feedback.md` _and_ in the terminal that launched
  the review — the feedback loop back to the agent.
- Or **Approve**: `check --ci` unblocks (once the other findings are dealt
  with). Edit the `dropTable` line afterwards and the approval invalidates
  automatically.

CLI equivalents: `pnpm agentlint approve <selector> --reason "..."` (refused
for agent actors) and `pnpm agentlint ledger review --base main`.

## 7. Reset the playground

```bash
git checkout -- ../../examples/demo && git clean -fd ../../examples/demo
```

## Where to look next

- Repo dogfooding: [.agentlint/config.ts](.agentlint/config.ts) enforces
  AGENTS.md conventions on agentlint's own source, gated in CI.
- Harness integrations: `agentlint init --harness claude-code` (PostToolUse
  hook), `agentlint mcp` (MCP server), `agentlint hook claude-code`.
- PR surface: the `ledger-review` workflow comments new dispositions and
  pending approvals on every PR — this branch's own PR has one.
