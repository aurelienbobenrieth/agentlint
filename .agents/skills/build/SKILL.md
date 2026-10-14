---
name: build
description: Implement an authorized feature, fix, or refactor test-first, with designs that stay deep, isolated, and small at their public surface. Use when changing code behavior, adding modules or exports, or reshaping boundaries. Not for explanation-only requests or unresolved requirements (see align).
---

# Build

**Smallest change that proves itself, in code that's easy to change next time.** A small edit stays a small edit.

## Before editing

- Inspect the working tree; existing work survives. Read the real validation commands and their side effects from config.
- "Can you fix this?" → act. Ask only for an outcome-changing decision or an action outside authorization; several open, interdependent decisions → [align](../align/SKILL.md) first.
- Unknown cause or unfamiliar boundary → a small probe before choosing the design.

## Loop

1. **Contract:** trigger → expected outcome, from the request or spec, before reading the implementation.
2. **Red:** one failing test per behavior slice, oracle per [testing](../testing/SKILL.md). Fails on the assertion, not a fixture.
3. **Green:** minimal code; tests read-only. Spec and test disagree → stop and report.
4. **Refactor** on green; structure and behavior changes in separate commits.
5. **Prove it:** doubt a green test → break the code, it must go red. Pick extra strategies (property, state model, contract, packed install) by the failure you fear, not by habit.

Defect → reproduce the symptom at its boundary first, cheapest distinguishing observation first; no reproduction → name the missing condition and keep the cause provisional. Covered, low-impact, reversible edit → no new test, still the full gate.

## Design

| Rule                                                                                          | Backed by                                             |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A module hides one decision; changing it touches one module                                   | `change-scatter-review`, `hotspot-change-review`      |
| Interface much smaller than what it hides; no pass-through wrappers                           | `abstraction-earns-keep`, `no-reexport-only-modules`  |
| Steps that must run in order sit behind one call                                              | `temporal-coupling`                                   |
| Two behaviors → two functions, not a flag                                                     | `flag-forked-function`                                |
| States as a discriminated union, not correlated optionals                                     | `correlated-optional-state`                           |
| Parse at the boundary into a type that carries the proof                                      | `validation-discards-proof`, `fallback-masks-failure` |
| Decisions in pure functions; I/O in a thin shell; test the core with values                   | `no-vitest-mocking`, `no-test-logic-in-production`    |
| Dependencies point inward: core never imports adapters, tests, or mutable shared state        | `no-mutable-exported-state`, `no-vitest-in-source`    |
| One declared public surface per package (`exports`); consumers never deep-import              | `workspace-boundaries`, packed consumer install       |
| Unit, test, and fixtures colocated; the folder deletes as a whole                             | —                                                     |
| Group by domain: errors live beside their schemas and API, not a file each; folder once big   | —                                                     |
| Duplicate until the third real use shows the shape; one adapter is hypothetical, two are real | `single-use-extraction-review`, `isomorphic-mapping`  |
| An abstraction growing per-caller branches → inline it back, re-extract                       | `abstraction-earns-keep`                              |

Costly public interface → sketch two genuinely different shapes before committing to one. Never for internals.

## Implement and verify

- Runtime limits, retry identity, cancellation, partial failure: design them in when the workload needs them.
- Stale generated code → run the generator (check whether it syncs externally). Never hand-write or widen substitute types.
- Parallel workers: bounded scope, file ownership, a verification task each; trust their evidence, not their confidence. Serialize shared mutable state.
- In a worktree, servers take their ports from `worktree-hygiene ports` with a strict port; before handoff `worktree-hygiene done` exits 0 (`--reap` stops what you started). Never stop a process by name or port alone.
- Prove at the failure boundary: real filesystem for a writer, consumer install for exports, browser for focus. A fake, static render, or compile proves only itself.
- Skipped, empty, stale, or unavailable ≠ pass. Rerun checks a later change invalidated; full gate on the final state.
- Final diff: no debug output, temp files, formatter churn, or scope creep.

**Handoff:** resulting behavior, checks run and results, material limits; readable without earlier progress messages. Never "done" with a failing gate.
