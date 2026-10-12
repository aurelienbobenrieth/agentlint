---
name: code-review
description: Review a diff, branch, or PR for defects that change outcomes and for drift from what was asked, beyond what lint, agentlint, and tests already enforce. Use when asked to review, before marking a non-trivial PR ready, or when assessing someone else's change. Not for style preferences, or for fixing unless the task includes it.
---

# Code Review

**Report what the gates can't catch. Every finding is verified, located, and fixable.**

## Scope

- Run the repo's gates first (`check`, agentlint `check`); report their failures as-is and don't re-derive what they already cover.
- PR → compare the intended branch range, not just the working diff. Inspect unfamiliar scripts before running them, especially from untrusted branches.
- Unrun checks are reported as unrun.

## Two axes

**Did it do what was asked?** Compare the change to the request, issue, or spec: missing behavior, unrequested behavior, silently changed contracts.

**Is it correct?**

- Follow changed values through parsing, auth, state updates, external calls, cleanup, outputs. Probe empty, repeated, partial-failure, cancellation, and concurrent cases.
- Public surface: exports, dependency ranges, generated files, migrations checked against real consumers; a green workspace build hides broken installs.
- Design: judge against [build](../build/SKILL.md)'s design rules, and only on concrete cost (a decision spread across modules, a hidden dependency, a pass-through layer, an unreachable branch), never on length or taste.
- Tests: would they catch the bug? Oracles independent of the code, fakes that can't share its mistake: see [testing](../testing/SKILL.md).

## Findings

- Falsify each via a caller, an invariant, or a minimal repro before reporting. Blocked → say what's uncertain.
- Format: location, trigger, consequence, fix direction. Rank by impact × likelihood; no quota.
- Return findings; fix only when authorized. None found → state the scope inspected and its gaps, never "looks good" as certification.
- Recurring issue → name the rule, check, or test that should own it. One finding doesn't justify a new rule.
