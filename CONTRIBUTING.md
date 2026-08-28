# Contributing

## Development

Use Node 22.19+ and pnpm 10+.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

The repository uses the Effect language service. Configure your editor to use the workspace TypeScript version.

## Architecture

- Keep parsing, Git evidence, persistence, application handlers, CLI formatting, and the browser UI separate.
- Prefer Effect services for infrastructure and Effect Schema for public or persisted contracts.
- The core package must remain useful without a model, server account, hosted service, or harness adapter.
- Add product rules in consumer packages or repositories, never in core.
- Treat acceptance compatibility as gate-critical code. Test changes to source identity, fingerprints, authority, lineage, and cleanup.

## Authoring rules

Every effective rule is one `defineRule` value with three explicit parts:

- `standard`: durable intent and guidance, with an identity and revision.
- `detector`: executable state or change detection, with an identity and version.
- `binding`: repository scope, detector options, and required authority.

Fixtures are activation evidence, not a catalogue of everything wrong. `mustReport` proves the detector activates on representative evidence. `mustStaySilent` protects important boundaries and false-positive regressions. Permitted examples in guidance show the right path to agents; fixture source is not included in normal feedback.

```ts
const rule = defineRule({
  lifecycle: "state",
  standard: {
    id: "data/bounded-reads",
    revision: 1,
    title: "Production reads are bounded",
    guidance: {
      standard: "Reads that scale with production data have an explicit bound or pagination contract.",
      examples: [{ code: "db.users.findMany({ take: 50 })" }],
    },
  },
  detector: {
    id: "prisma/find-many-without-take",
    version: 1,
    match: { pattern: "$DB.findMany($$$ARGS)", where: { notHas: "take: $_" }, message: "$DB is unbounded." },
    fixtures: {
      mustReport: ["db.users.findMany({})"],
      mustStaySilent: ["db.users.findMany({ take: 50 })"],
    },
  },
  binding: { id: "data/bounded-reads", authority: "agent", include: ["src/**/*.ts"] },
});
```

Use declarative `pattern` or tree-sitter `query` matching for local syntax. Use `createOnce` for stateful repository analysis. Use `lifecycle: "change"` when the judgment depends on before/after evidence rather than current source alone.

Run `pnpm agentlint rules test` and a calibration scan before enabling a new binding.

## Changesets

Add a changeset for public API, CLI, persisted data, dependency, or packaged-skill changes. Use conventional commit prefixes.
