# Local harness audit

The local harness is useful as an audit tool and as a source of selected development checks. Installing every strict preset permanently would impose unrelated framework rules and broad style preferences. Development checks do not belong in agentlint's runtime dependencies or shipped default rules.

## Packages selected

| Packages                                                                         | Use in this repository                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| agentlint-plugin-core, agentlint-plugin-effect                                   | Run local judgment reviews over implementation code. Evaluate findings against the actual boundary, not as automatic defects.                                                                    |
| oxlint-plugin-core, oxlint-plugin-effect                                         | Run all candidate rules, then retain narrowly scoped correctness checks.                                                                                                                         |
| conformance-core                                                                 | Evaluate dependency overlap, dead exports with Knip, and implementation duplication with jscpd.                                                                                                  |
| oxfmt-config, oxlint-config                                                      | Inspect for conventions. Keep the repository's existing formatter/linter configuration; the harness baseline and this workspace use different tool versions.                                     |
| Lit, XState, TanStack Query, Shopify plugins/conformance, Shopify stylelint, oio | Migrate their agentlint API where applicable, but do not install their domain rules here: the review application uses FoldKit.                                                                   |
| oxlint-plugin-type-evidence                                                      | Requires its own type-aware evidence workflow; it is not interchangeable with the ordinary JavaScript plugins. The repository already runs TypeScript and validates its public consumer surface. |

No harness runtime dependency was added. Audit configurations and tool installations live in ignored `local-packages/harness-audit`; temporary root configurations are removed after execution. The seven harness plugins are updated in the sibling repository, with their own changeset and [migration review](../../harness/docs/reviews/agentlint-current-contract.md).

## Findings and resulting changes

- Public JSON visitors lacked the `document` root despite the shipped JSON grammar supporting it. Add the type and real-parser regression fixtures.
- Strict packed-consumer checking exposed unused tree-sitter imports in public declaration bundles, which required an absent Emscripten type. Separate public node/error/fixture contracts from parsing implementation modules and remove the smoke test's `skipLibCheck` exemption.
- A literal NUL in the syntax-highlighting cache key made its TypeScript source unparsable. Use the equivalent escaped character.
- Review HTTP operations used `Effect.promise`, turning network failures into defects outside the intended recovery path. Use typed recoverable errors, preserve failed decisions, bound requests to 30 seconds, and propagate cancellation. Malformed JSON and browser storage errors use the same recoverable boundary.
- Acceptance/proposal timestamps now use Effect's clock, so orchestration can be tested with controlled time. Detection remains independent of time.
- Bound editor discovery probes to five seconds and Git comparisons to two minutes per command, with cancellation. Action HTTP requests have a 30-second deadline, action subprocesses and reference sync a five-minute deadline. REST and GraphQL pagination reject repetition and excessive pages; REST links retain the authenticated API origin.
- Remove unused module exports and an unused lineage helper. Published package exports remain intact. Share reason-field input/accessibility wiring between the two decision forms.

The initial candidate oxlint run reported 391 diagnostics: 205 multiple-positional-parameter preferences, 66 `let` preferences, and 25 explicit-return-type preferences account for most of the noise. Those are not grounds for restructuring this code wholesale. Fixture stubs intentionally contain negative examples and are excluded from the implementation audit.

After rule repairs and fixes, the judgment audit produced 71 review prompts: 18 delegation reviews, 19 execution-bound reviews and 34 manual-contract reviews. These counts describe review work, not 71 known defects:

- Delegations include package-facing Promise adapters, canonical encoders, normalized identifiers and platform wrappers. Their boundary is useful; removing it would expose implementation details or repeat semantics at callers.
- Manual contracts describe visitors, executable configuration, parser trees, maps, internal session bookkeeping and already-decoded data. Persisted and wire values retain their Effect Schemas. Exporting a compile-time interface alone does not create an unvalidated runtime boundary.
- Execution sequences in the action have dependent Git/API steps, pagination and ordered comment reconciliation. They use bounded transport/process operations; parallelizing writes indiscriminately would change behavior. Editor discovery fans out over five fixed applications. A live review session intentionally waits for user decisions; the synchronous detector engine does not own that session lifetime.

The audit does not create blanket acceptance records. These temporary bindings are removed; if a repository adopts them permanently, decisions should be recorded against that repository's selected standards and exact current evidence.

## Rules worth adopting after the harness release

- Core oxlint: prevent Vitest imports in implementation code, mutable exported state, and weak test assertions. Keep test-double policies scoped to tests and distinguish mocked internals from injected external ports.
- Effect oxlint: floating Effects, unsafe Effect bodies/error channels, schema misuse and ambient nondeterminism. Declare legitimate runtime entrypoints for the review server and Promise-based testing API. Keep finalizer failure handling deliberate.
- Agentlint: boundary resilience and bounded work for I/O code; bounded data access when persistence queries appear; schema-contract review at wire/persistence boundaries. Abstraction and comment review are optional editorial checks.
- Do not enable global bans on `let`, `switch`, positional arguments, array helpers or layer composition. Apply a narrower rule only when the repository has a concrete invariant it protects.

## Evidence and limits

The three applicable conformance checks execute with zero findings after cleanup. The duplication scope excludes examples, recorded fixtures, tests, generated/vendor files, prose and workflows; their repetition is deliberate. Knip keeps the explicit Effect runtime alignment dependency and dynamically consumed build/skill tools. The closed-design-system probe is unconfigured and reported as skipped, so the generic four-check report correctly remains `incomplete`.

`pnpm check` passes in both repositories: 188 agentlint tests and 1,386 harness unit tests, plus the harness policy/catalog/release suites. One harness run had an unexpected worker exit; the complete rerun passed.

Chrome QA exercises desktop/mobile layouts, keyboard navigation, server errors, interrupted network connections, acceptance/revocation, export/import and calibration. The isolated packed consumer checks eight actual archives, TypeScript consumers, real parser fixtures and the CLI across all seven plugin domains.

The eight-archive test uses the exact **local runtime dependency graph**. Separately, the engine tarball passed `scripts/smoke-package.mjs` in a fresh npm consumer, including strict TypeScript checking and the finding/acceptance gate workflow. Keep the harness plugins private until the engine has a published release with a distinct compatible version, then update all peer contracts. No release or deployment is performed by this audit.

The full 21-package `pnpm test:package` packs only `packages/*`, excluding the private workspace root. Fresh pnpm installation, dependency audit, strict TypeScript, 25 runtime exports, three lint runners and five scaffold kinds pass: 33 tests passed and three explicitly allowed conformance checks skipped across seven files. Oio now pins Effect and both Node platform packages to `4.0.0-rc.112`, removing the beta.85 declaration failure. No `skipLibCheck` or declaration exemption is used.
