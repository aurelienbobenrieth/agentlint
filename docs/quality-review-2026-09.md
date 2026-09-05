# Product and engineering improvement pass

Date: 2026-09-05. Scope: the current refactoring draft, before publication.

## Product decision

agentlint remains useful when a repository needs an explicit decision for a recurring review obligation. Its value is a checkpoint with exact evidence and attributable reasoning. Model capability can improve the judgment made at that checkpoint; it does not replace the repository's decision policy or its stored record.

Prioritize individual developers and small teams together: local adoption, one useful rule, shared policy in Git, minimal maintenance, and review continuity between humans and agents. Enterprise identity and policy distribution remain optional integration concerns.

An open gate means every finding in the reported scope has a compatible acceptance. It does not establish code correctness, complete concern coverage, authenticated local identity, or enforcement outside the checkpoint where `check` runs. This promise is now explicit in the README and coverage output. The [pilot worksheet](review-pilot.md) tests whether saved review effort exceeds rule maintenance and interruptions. No user pilot or comparison between models was performed in this pass.

## Implemented

| Area                  | Concrete change                                                                                                                                                       | Evidence                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Finding identity      | Independent structural occurrences; complete identity selectors; exact Unicode and ordered detector options                                                           | Regression tests for duplicate calls, shared digests, guards, Unicode and option order          |
| Evidence invalidation | Version 2 state fingerprints include containing-file syntax and declared supporting files; imperative detectors default to repository scans                           | Guard removal, formatting, supporting-file changes, unchanged source outside Git's changed list |
| Scan integrity        | Invalid configuration, missing paths, unreadable files, unsupported/incomplete syntax, and paths outside the repository fail the scan                                 | Failure and acceptance-preservation regressions                                                 |
| Decisions             | Partial updates replace exact identities only; request changes revokes acceptance; calibration cannot mutate it                                                       | Sequential acceptance loop, review handler and import tests                                     |
| Storage               | Exclusive filesystem transaction lock, validated temporary write, atomic rename, conditional revocations checked inside the transaction                               | Concurrent independent stores, simulated rename failure, replay/stale revocation tests          |
| Review workflow       | Shared source snapshots, visible coverage, invalidation context and declared authority; requested changes keep the gate closed                                        | Server and UI state tests; artifact remains tied to the original scanned source                 |
| Public API            | Heterogeneous typed options compose; Promise testing helpers include repository fixtures; runtime rule validation                                                     | Typecheck and a strict external TypeScript consumer compiled from the installed tarball         |
| Fixtures              | State fixtures use the production executor; compact change fixtures compare lines instead of reporting unchanged lines as additions                                   | Real Git staged/unstaged/untracked fixture parity and focused hunk tests                        |
| Runtime cost          | No full change snapshots for state-only scans; bounded Git concurrency; cached binding/dependency identity; disposed syntax resources; single scan for review exports | State-only Git regression, normal test suite, benchmark below                                   |
| Packaging             | Publish-only exports omit workspace source conditions; missing packaged grammars fail the build; consumer smoke checks runtime and public types                       | Build, packed installation, fixture/explain/accept/check smoke flow                             |
| Delivery              | LF policy, Windows/macOS/Linux CI matrix, Node 22/24 matrix, changeset, updated ADRs and packaged skills                                                              | Local formatting, skill validation and workflow review; remote matrix not executed here         |
| Trust boundaries      | Action rejects `pull_request_target`; artifact source confidentiality and executable configuration documented                                                         | Action test verifies rejection before CLI execution or GitHub calls                             |

## Compatibility

- Existing fingerprint version 1 records decode but cannot satisfy version 2 findings. Review again; do not rewrite their version fields to retain authority.
- Review artifacts now use version 2. Regenerate older artifacts and update custom contract consumers for shared sources and coverage.
- Public testing uses Promise helpers. Consumers of removed internal Effect runners must migrate.
- Full containing-file structure is deliberately conservative. A structural change elsewhere in the file can require another decision. Whitespace between syntax nodes is ignored; literal and comment contents remain material.
- `binding.dependencies` applies to state bindings. Change detectors must include their supporting comparison in explicit reported evidence. The engine does not infer transitive dependencies.

## Validation and measurements

Local environment: Windows, Node 24.15.0. The complete validation command is `pnpm check`. The packed package was installed in a fresh temporary consumer; its CLI, all bundled grammars, contract exports, dependency runtime and strict TypeScript authoring passed. The production dependency audit reported no known vulnerabilities at the time of the run. Packed size: approximately 1.05 MB.

Run `pnpm build`, then `node scripts/benchmark.mjs`. The script creates a temporary repository with 100 TypeScript files and ten findings per file, launches a new CLI process for each of five samples, and includes startup, reporting and persistence. Local medians with no test/build process running alongside it:

| Scenario                            | Median   |
| ----------------------------------- | -------- |
| Complete scan, 1,000 findings       | 1,499 ms |
| One explicit file, 10 findings      | 1,458 ms |
| Complete scan and detached artifact | 1,505 ms |

These are a reproducible reference point, not a before/after speedup claim or a representative enterprise benchmark. Similar partial/full latency suggests startup dominates this small scenario; profiling is needed to confirm the cause. Large repositories, many bindings, memory growth and cross-platform latency need separate measurements.

## Remaining limits and next decisions

1. Run the pilot on actual individual and small-team work. Measure useful interceptions, repeated review cost and rule maintenance before growing the product surface.
2. Profile CLI startup and larger repositories. Consider further loading isolation or caching only after profiling identifies the cost and a safe invalidation contract.
3. Measure conservative fingerprint invalidation in practice. Narrower evidence scopes need regression evidence that they cannot retain acceptance after a relevant guard or dependency changes.
4. Browser QA completed in local Chrome using an isolated headless profile. Desktop rendering and widths of 320, 390 and 820 pixels were checked, along with mobile selection, keyboard help/search/acceptance, an HTTP failure, accept/request changes/undo, finishing, detached export/import/revocation and calibration. This is Chrome validation, not a cross-browser or assistive-technology certification.
5. The remote Linux/Node 22 and 24, macOS/Node 22, and Windows/Node 22 matrix passed after correcting a macOS canonical-path bug. Re-run it for subsequent changes. Effect remains pinned to a prerelease; the compiler build also reports an experimental TypeScript API warning.
6. Treat local authority as declared accountability. Authenticated provider identity, protected-branch enforcement and tamper-resistant history require deployment-level controls; the core has no cryptographic identity service.
7. Treat the acceptance transaction guarantees as local filesystem guarantees. Abrupt process death can leave a lock requiring manual recovery. Power-loss durability, network filesystem semantics and a persistent historical ledger are not certified. Proposal and selector files remain contextual stores, outside the acceptance transaction.
8. Keep detectors deterministic and trusted. In-process repository code can still use external state or change files. The engine's deterministic contract is not a sandbox against deliberately nondeterministic or malicious rules.

Changes were committed and pushed to PR #32 for remote validation. No merge, release or deployment was performed.

## Pre-release follow-up

The pre-v1 policy is to support the current API and artifacts without migration adapters. Complete finding identity hashes are the only supported digest selectors; the old evidence-only selector fallback was removed. Version checks remain essential to reject incompatible evidence.

Attached UI actions now update decision drafts only after server confirmation, serialize submissions and prevent finishing during a pending request. Calibration displays calibration progress, not an open gate. Detached reviews expose undo only for local decisions; use request changes to revoke an acceptance carried by the artifact.

Browser testing exposed and corrected three issues: narrow-screen overflow (578 pixels of content in a 390-pixel viewport), keyboard help without modal focus management, and calibration choices disappearing from the queue before Save label could be pressed. The corrected mobile header keeps Finish visible, selecting a finding returns to its details, keyboard help uses a native modal, and only saved calibration labels leave the queue. Existing code acceptances no longer count as completed calibration. The full Chrome scenario was rerun successfully, with no page JavaScript errors.
