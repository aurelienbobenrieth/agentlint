# agentlint

Deterministic findings and explicit judgment gates for coding agents.

agentlint is for concerns that are too contextual for a conventional linter and too important to leave to prompt recall. It deterministically selects review points, supplies the repository standard, and blocks until the evidence changes or an acceptance with sufficient authority matches the exact finding.

It does not call an AI model. It does not ship rules. Repositories and plugin packages own their standards, detectors, and policy.

## The model

```text
repository evidence -> deterministic detector -> finding
finding + exact compatible acceptance -> gate open
finding without acceptance             -> gate closed
```

A rule is the composition of:

- a durable, revisioned `standard`;
- a versioned `detector`;
- a repository-owned `binding` containing scope, options, and `agent` or `human` authority.

`state` rules judge current repository structure. `change` rules judge normalized before/after evidence from the Git merge base to the complete working tree.

## Install

```bash
pnpm add -D @aurelienbbn/agentlint
pnpm agentlint init
```

`init` creates `.agentlint/config.ts` and ignores only the ephemeral selector cache. Commit the config and `.agentlint/acceptances.jsonl` when it exists.

## Define a state rule

```ts
import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

const boundedReads = defineRule({
  lifecycle: "state",
  standard: {
    id: "data/bounded-reads",
    revision: 1,
    title: "Production reads are bounded",
    guidance: {
      standard: "Reads that scale with production data have an explicit bound or pagination contract.",
      checks: ["A hard limit, cursor, or proven finite dataset can satisfy the standard."],
      examples: [{ label: "Explicit bound", code: "db.users.findMany({ take: 50 })" }],
    },
  },
  detector: {
    id: "prisma/find-many-without-take",
    version: 1,
    match: {
      pattern: "$DB.findMany($$$ARGS)",
      where: { notHas: "take: $_" },
      message: "$DB has no explicit bound.",
    },
    fixtures: {
      mustReport: ["db.users.findMany({})"],
      mustStaySilent: ["db.users.findMany({ take: 50 })"],
    },
  },
  binding: {
    id: "data/bounded-reads",
    authority: "agent",
    include: ["src/**/*.ts"],
    exclude: ["**/*.test.ts"],
  },
});

export default defineConfig({ rules: [boundedReads] });
```

Patterns are parsed code shapes, not text searches. `$NAME` captures one node, `$_` matches one node, and `$$$ARGS` matches sibling sequences. A raw tree-sitter `query` can designate its result with `@match`. `createOnce(context)` is the imperative escape hatch for stateful and repository-wide detectors.

Fixtures are focused evidence. `mustReport` proves activation. `mustStaySilent` protects valuable boundaries. They need not enumerate every possible mistake, and their code is never sent to the agent as normal guidance.

### Sources and references

`standard.source` records the durable policy or decision that explains why the standard exists. It accepts a URL (`{ type: "url", href }`) or a repository file (`{ type: "file", path }`). It is provenance, not detector input, and changing it does not change what a rule matches.

`standard.guidance.refs` adds material that can help make the current judgment. A reference is either a browser URL (`{ type: "url", href }`) or an agent skill (`{ type: "skill", id }`). References do not activate a rule and do not open a gate.

The review UI opens safe HTTP(S) references in a new tab. Repository-file sources and skill identifiers remain typed targets in the copied finding context; the browser does not pretend it can resolve them. This keeps the contract useful to agents without turning an unresolved identifier into a broken link.

During an attached review, the localhost server detects supported editors and file explorers. The first **Open in…** action asks which detected application to use and remembers that choice locally. The browser sends only the finding identifier and selected allowlisted application; the server resolves and validates the repository path before opening it. Detached artifacts contain neither machine paths nor application capabilities.

## Define a change rule

Use change rules when the concern is the operation, not merely the resulting source.

```ts
const destructiveMigration = defineRule({
  lifecycle: "change",
  standard: {
    id: "database/destructive-migrations",
    revision: 1,
    title: "Destructive schema changes receive human review",
    guidance: {
      standard: "A destructive migration includes a verified backfill, rollback, and deployment sequence.",
      examples: [{ code: "// Expand, backfill, verify, then contract in a later deployment." }],
    },
  },
  detector: {
    id: "sql/destructive-operation",
    version: 1,
    detect(context) {
      for (const file of context.change.files) {
        for (const hunk of file.hunks) {
          const destructive = hunk.lines.find(
            (line) => line.kind === "addition" && /drop\s+(table|column)/i.test(line.content),
          );
          if (!destructive) continue;
          context.report({
            key: `${file.path}:destructive-schema`,
            lineageKey: `${file.path}:destructive-schema`,
            file: file.path,
            message: "This change introduces a destructive schema operation.",
            evidence: { operation: destructive.content.trim() },
            excerpt: destructive.content,
            startLine: hunk.newStart,
          });
        }
      }
    },
    fixtures: {
      mustReport: [{ before: {}, after: { "migration.sql": "DROP TABLE legacy_users;" } }],
      mustStaySilent: [{ before: {}, after: { "migration.sql": "CREATE TABLE users (id int);" } }],
    },
  },
  binding: {
    id: "database/destructive-migrations",
    authority: "human",
    include: ["migrations/**"],
  },
});
```

The engine compares the selected ref's merge base with the current working tree. The evidence includes committed branch changes, staged and unstaged edits, renames, deletions, and untracked files. `--base <ref>` is explicit; otherwise agentlint detects an upstream or conventional main branch and fails clearly if no valid base exists.

## Run the gate

```bash
pnpm agentlint rules test
pnpm agentlint check                 # changed files plus all change rules
pnpm agentlint check --all           # complete state scan and safe stale cleanup
pnpm agentlint check --base main
pnpm agentlint check --format jsonl
```

Exit code `1` means unresolved findings. Exit code `2` means invalid usage, configuration, or evidence. Local and CI checks have identical gate semantics.

For an agent-authority finding:

```bash
pnpm agentlint explain 1
pnpm agentlint accept 1 --reason "The upstream route caps every request at 100 rows."
```

For a human-authority finding, open the review UI or use the explicit human entry point:

```bash
pnpm agentlint review
pnpm agentlint approve 1 --reason "Backfill and restore drill linked in the migration."
```

An agent acceptance cannot satisfy a human binding. A human acceptance can satisfy either authority.

When an agent has done the work but cannot decide, it records a proposal so the reviewer sees the change next to the evidence:

```bash
git diff src/migrations/2026-06-drop-legacy-flag.ts > /tmp/backfill.diff
pnpm agentlint propose 6 --summary "Added an idempotent backfill before the drop." --diff-file /tmp/backfill.diff
```

`.agentlint/proposals.jsonl` holds one proposal per exact finding identity. A proposal is context for a human; it never opens a gate.

## Acceptance identity

`.agentlint/acceptances.jsonl` contains current state, not an event log. An acceptance opens a gate only when all material identity agrees:

- standard id and revision;
- detector id and version;
- binding id and material binding digest;
- fingerprint scheme, version, and evidence digest;
- sufficient authority.

State fingerprints normalize syntax so a line move or formatting-only edit can retain acceptance. Material code changes invalidate it. Change detectors own their material `evidence`; changing it invalidates acceptance. Optional lineage can show a prior reason after invalidation, but it never opens the new gate.

Complete scans remove dead acceptances. Partial scans preserve anything they did not examine.

```bash
pnpm agentlint acceptances list
pnpm agentlint acceptances clean
```

## Review and calibration

`agentlint review` serves the packaged FoldKit SPA on loopback with a session token. The **Queue** lists everything that still needs a decision, grouped by file, with the agent's proposal (summary and diff) shown next to the code when one exists. The **Decisions** view lists what is already accepted, by whom and when, so a human can audit agent acceptances and request a correction. Both feed the same handoff the coding agent receives when the review finishes.

The UI is keyboard-first: `J`/`K` move, `A` accepts, `R` requests changes, `E` opens the editor, `C` copies context, `/` searches, `F` opens filters, `1`/`2` switch views, `X` dismisses a toast, `?` lists everything. Requesting changes needs no text; accepting needs a reason unless an agent proposal exists, in which case the proposal becomes the reason.

Calibration exercises a detector without creating acceptance state:

```bash
pnpm agentlint rules scan --rule data/bounded-reads --review
```

Use it on an existing codebase to label matches as applies, does not apply, or unsure. Refine the rule, binding, guidance, and fixtures from the temporary feedback.

## Detached CI review

CI must not wait for a browser. It can emit a portable artifact while keeping the gate closed:

```bash
pnpm agentlint check --all --review-output artifacts/agentlint-review.json
```

Download the artifact, then open it locally:

```bash
pnpm agentlint review --from artifacts/agentlint-review.json
```

The detached UI stages decisions in the browser. It exports requested changes as Markdown and accepted decisions as exact `AcceptanceRecord` JSONL. Bring reviewed acceptances back through the validation path:

```bash
pnpm agentlint acceptances import agentlint-acceptances.jsonl
pnpm agentlint check --all
```

Import re-runs the repository detectors. Decisions whose finding changed, disappeared, or no longer has compatible authority are rejected.

## CLI reference

```text
agentlint check [files...] [--all] [--base ref] [--rule id]
                [--format text|jsonl] [--review-output path]
agentlint accept <selector> --reason "..." [--base ref]
agentlint approve <selector> --reason "..." [--base ref]
agentlint propose <selector> --summary "..." [--diff-file path] [--base ref]
agentlint explain <rule-id|selector>
agentlint review [--base ref] [--mode review|calibration] [--from artifact]
agentlint rules list|test|scan
agentlint acceptances list|clean|import
agentlint init
```

The selector cache under `.agentlint/.cache/` only maps short run-local numbers such as `1` back to full finding identities. It is disposable and must not be committed.

## CI

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
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v5
      - uses: actions/setup-node@v5
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

`fetch-depth: 0` is required because change rules use the merge base. The artifact step is safe on untrusted pull requests: it uploads repository-derived review data and needs no write permission, secret, bot, or waiting browser. Open it locally with `pnpm agentlint review --from agentlint-review.json` and bring decisions back through `acceptances import` (see [Detached CI review](#detached-ci-review)).

## Integration boundary

The core package contains no MCP server, harness hook, GitHub bot, or provider SDK. Integrations call the CLI and read its exit code:

| Exit code | Meaning                                             |
| --------- | --------------------------------------------------- |
| `0`       | Every current finding has a compatible acceptance.  |
| `1`       | One or more findings are unresolved.                |
| `2`       | The command, configuration, or evidence is invalid. |

A harness can continue after a non-blocking `check` during a work loop, but it must report unresolved findings before it finishes. Use `check --all` as the hard gate at a checkpoint and in CI.

Provider adapters (pull-request comments, ownership routing, signed human authority) belong outside the engine. They must preserve the same current-finding and acceptance semantics, and they are added only when the CLI and artifact contract cannot provide the required experience.

## Public API

`@aurelienbbn/agentlint` exports what a rule or config author needs and nothing else:

- `defineConfig` and `defineRule`, with the `AgentlintConfig`, `AgentlintRule`, `StateRule`, `ChangeRule`, `RuleBinding`, `RuleStandard`, `Guidance`, `RuleMatch`, and `Visitors` types.
- `RuleContext` (`absolutePath`, `path`, `source`, `report`) and `ChangeRuleContext` for detector implementations, plus `AgentlintNode` and `TreeSitterNodeType`.
- The change evidence schemas (`ChangeSet`, `ChangedFile`, `ChangeHunk`, `ChangeLine`, `FileSnapshot`, `ChangeBaseline`) and `FindingRecord` as runtime values, so a consumer can construct or decode them.
- Tagged errors: `RuleDefinitionError`, `ConfigError`, `PatternError`, `ParserError`.

`@aurelienbbn/agentlint/testing` exports the promise-based helpers `testRuleFixtures`, `testRuleOnSource`, and `testRuleOnChange`, the Effect-based runners `runRuleFixtures`, `runRuleOnSource`, `runRuleOnSources`, and `runRuleOnChange`, `normalizeChangeFixture`, and the `FixtureReport` and `FixtureFailure` types.

The package intentionally exports no bundled standards, detectors, rules, or presets.

## Security boundary

Local human authority is accountability, not cryptographic identity. A process with repository write access can edit configuration and acceptance files. Git review makes those changes visible. Provider-backed proof can be added later without changing the core gate semantics.

## License

[MIT](LICENSE)
