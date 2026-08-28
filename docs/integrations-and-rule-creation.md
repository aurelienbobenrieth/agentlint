# Integrations and rule creation

agentlint 0.2 keeps one product path. The CLI, local review server, and review SPA use the same application handlers. Integrations call the CLI.

## Integration boundary

The core package does not contain an MCP server, a harness hook, a GitHub bot, or a provider SDK.

This boundary keeps the gate portable. It also keeps provider credentials and delivery policy outside the engine.

A coding harness can run these commands:

```bash
agentlint check
agentlint check --all
agentlint review
```

Use `check` during a work loop. It scans changed state files and evaluates all change rules. Use `check --all` at a checkpoint and in CI.

The command exit code is the integration contract:

- `0`: all current findings have compatible acceptances.
- `1`: one or more findings are unresolved.
- `2`: the command or configuration is invalid.

The harness can continue after a non-blocking development check. It must report unresolved findings before it finishes. A repository can use the complete check as a hard gate.

## Review transports

`agentlint review` starts an attached local session. Accepted decisions write directly to `.agentlint/acceptances.jsonl`.

`agentlint check --review-output <file>` writes a provider-neutral detached artifact. CI never waits for a browser.

`agentlint review --from <file>` opens the detached artifact. The reviewer can export exact acceptance JSONL and copy requested changes for an agent.

`agentlint acceptances import <file>` recomputes the current findings before it stores an acceptance. The command rejects records that no longer match.

## Create a rule

The package exports one `defineRule` function. Its `lifecycle` field selects a state rule or a change rule.

Each effective rule contains three parts:

1. The standard states the durable review question.
2. The detector finds evidence.
3. The binding applies repository policy.

The core package does not publish product rules. A repository or a third-party package owns its standards, detectors, and bindings.

### State rule

A state detector inspects the current source. Pattern detectors use tree-sitter syntax. A custom detector can use the state context.

```ts
const rule = defineRule({
  lifecycle: "state",
  standard: {
    id: "data/bounded-queries",
    revision: 1,
    title: "Production queries have a growth bound",
    guidance: "Use a limit, cursor, or documented finite boundary.",
  },
  detector: {
    id: "prisma/find-many-without-take",
    version: 1,
    match: {
      pattern: "$DB.findMany($$$ARGS)",
      where: { notHas: "take: $_" },
      message: "$DB has no explicit query bound.",
    },
    fixtures: {
      mustReport: ["db.users.findMany({ where: { active: true } })"],
      mustStaySilent: ["db.users.findMany({ take: 50 })"],
    },
  },
  binding: {
    id: "data/bounded-queries",
    authority: "agent",
    include: ["src/**/*.ts"],
  },
});
```

### Change rule

A change detector inspects a normalized Git change set. It receives file status, before and after snapshots, and parsed hunks.

```ts
const rule = defineRule({
  lifecycle: "change",
  standard: {
    id: "database/destructive-migrations",
    revision: 1,
    title: "Destructive migrations receive human review",
    guidance: "Verify the backfill, rollback, and deployment order.",
  },
  detector: {
    id: "text/destructive-schema-addition",
    version: 1,
    detect(context) {
      for (const file of context.change.files) {
        if (!file.after?.content.includes("dropTable")) continue;
        context.report({
          key: file.path,
          lineageKey: file.path,
          file: file.path,
          message: "This change adds a destructive schema operation.",
          evidence: { path: file.path },
        });
      }
    },
    fixtures: {
      mustReport: [{ before: {}, after: { "migration.ts": "db.dropTable('old')" } }],
      mustStaySilent: [{ before: {}, after: { "migration.ts": "db.createTable('new')" } }],
    },
  },
  binding: {
    id: "database/destructive-migrations",
    authority: "human",
    include: ["src/migrations/**"],
  },
});
```

## Fixture purpose

`mustReport` gives the detector a positive trigger example. It proves that the detector can find required evidence.

`mustStaySilent` gives the detector a permitted example. It protects the intended path from false findings.

Fixtures define representative boundaries. They do not claim to enumerate all incorrect code. Use detector design, repository scans, and calibration review to find missing classes.

Run:

```bash
agentlint rules test
agentlint rules scan --review
```

`rules test` is deterministic. `rules scan --review` lets a person inspect detector behavior on the repository before enforcement.

## Version changes

Increase a standard revision when the review question changes.

Increase a detector version when the evidence meaning changes.

Change the binding identity when repository policy changes.

Fingerprint schemes and acceptance records have independent versions. Do not change their inputs without an explicit compatibility decision.

## Future adapters

A provider adapter can add PR comments, ownership routing, or signed human authority. It must preserve the same current-finding and acceptance semantics.

Add an adapter only when the CLI and artifact contract cannot provide the required experience. Do not add provider logic to the engine.
