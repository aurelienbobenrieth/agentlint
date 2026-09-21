# Local harness audit

The sibling `harness` repository was packed locally and applied to this repository as an audit. Its strict refactoring preferences were kept enabled. The audit dependencies and temporary configuration were removed after validation; agentlint does not retain a development dependency on unpublished harness packages.

## Strict lint and formatting

The initial strict oxlint pass reported 391 diagnostics. The repository was refactored until the same configuration reported zero diagnostics; preference rules were not disabled to make the run pass. In particular, declarations remain independent because the harness now configures `eslint/one-var` as `never`.

The cleanup includes Effect-native collection and matching APIs, explicit schemas and error channels at data boundaries, bounded asynchronous work, named exported object-return values, shared JSON encoding, and smaller test fixtures. The harness formatter was applied across the repository and its final check passed.

Fixture directories and generated declarations retain their normal lint exclusions. The harness-specific plugins were enabled together for implementation code, with only boundary-specific exceptions where direct process access or raw JSON is the purpose of the action and packaged-skill runtime.

## Conformance

The applicable conformance checks finish with no findings:

- dependency overlap: clean;
- duplication: zero exact clones with a zero-clone budget across source, tests, examples, workflows, and prose;
- dead exports: clean Knip report;
- TypeScript strictness: all required flags, including `noImplicitOverride` and `noFallthroughCasesInSwitch`, are enabled.

The generic closed-design-system probe is reported as skipped because this repository has no closed CSS build or selector probe configured. That makes the aggregate report `incomplete`, not failed; no conformance finding is suppressed.

## Behavioral fixes found during the audit

- Public JSON visitors include the `document` root supported by the shipped grammar.
- Public declaration bundles no longer leak unused tree-sitter implementation imports, and packed consumers typecheck without `skipLibCheck`.
- Review HTTP and browser storage failures use typed recoverable boundaries, with cancellation and time limits preserved.
- Acceptance and proposal timestamps use Effect's clock, allowing deterministic orchestration tests.
- Editor discovery, Git commands, action HTTP requests, subprocesses, and reference synchronization are bounded. Pagination rejects repetition, excessive pages, and REST origin changes.
- The review server and action use explicit Effect services and structured errors rather than ambient or stringly control flow.
- Repeated workflow validation, payment-rule examples, feature-test services, and artifact-selection fixtures share one implementation while preserving their behavior.

## Verification scope

The repository's own `pnpm check` remains the final gate. Dependency, build, or CLI-entry changes also require the packed-package smoke test. The sibling harness is verified independently with its complete `pnpm check` and `pnpm test:package` suites before the draft pull request is updated.
