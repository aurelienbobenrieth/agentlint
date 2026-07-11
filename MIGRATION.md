# Migrate from agentlint 0.1.x to 0.2.0

0.2.0 replaces the reviewed-flag workflow with findings, guidance, explicit dispositions, and an append-only ledger. Treat the upgrade as a deliberate cutover.

## 1. Move the config

Move `agentlint.config.ts` to `.agentlint/config.ts`. Root-level configs are no longer discovered.

## 2. Update rules

Rules now use `id`, `description`, `guidance`, and either structural `match` entries or `createOnce(context)`. Report findings with `context.report({ node, message })`. Move file routing and resolution policy into `defineConfig`.

```ts
const rule = defineRule({
  id: "data/bounded-query",
  description: "Flags queries without a bound.",
  guidance: {
    standard: "Queries that grow with production data need an explicit bound.",
    checks: ["A limit, cursor, or documented finite dataset satisfies the standard."],
  },
  match: [{ pattern: "$DB.findMany($$$ARGS)", where: { notHas: "take: $_" }, message: "$DB is unbounded." }],
  fixtures: { invalid: ["db.findMany({})"], valid: ["db.findMany({ take: 50 })"] },
});
```

## 3. Replace commands

| 0.1.x                     | 0.2.0                                                  |
| ------------------------- | ------------------------------------------------------ |
| `agentlint list`          | `agentlint rules list`                                 |
| `agentlint review <hash>` | `agentlint resolve <selector> --accept --reason "..."` |
| `.agentlint-state`        | committed `.agentlint/ledger.jsonl`                    |

Run `agentlint rules test`, then `agentlint check --all`. Resolve each finding deliberately; do not translate old reviewed flags automatically because the new ledger records an accountable reason and actor.

## 4. Add CI

Use `agentlint check --all --ci` so deferred and approval-requested findings block merges. Copy the complete workflow from [docs/github-actions.md](docs/github-actions.md).

## 5. Review the result

Run `agentlint review` to inspect human-gated findings, new agent dispositions, and unresolved work. Commit `.agentlint/ledger.jsonl`; keep `.agentlint/.cache/` ignored.
