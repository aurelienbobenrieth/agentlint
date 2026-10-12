---
name: git
description: Stage, commit, resolve conflicts, rewrite history, push, and write pull requests while preserving existing work. Use when the task includes a git or PR operation; a code change alone never implies committing or opening a PR.
---

# Git

## Staging and commits

- Read `git status --short`, `git diff`, `git diff --cached` first; separate task changes from pre-existing work.
- Stage explicit paths (`git add -- <paths>`) or hunks, then re-read the staged diff. Never sweep pre-existing staged work into a task commit; shared index → isolated worktree.
- One change per commit, with its tests, docs, changeset; a fix keeps its regression test.
- Repo convention first. Conventional Commits: `type(scope): description`, `!` for breaking. Title from the final diff; body only for what it can't show; closing keywords only when resolved.
- Keep author, signing, hooks.
- **Never credit a model or agent**: no LLM `Co-Authored-By`, no "Generated with…" line, in commits or PR descriptions, even when the host tool adds one by default.
- Hook failure → read status and output. The attempt usually made no commit: don't `--amend` the previous one. Fix, retry; never bypass.

## History and branches

- Conflicts: keep both sides' intended behavior, run affected checks. Ask when business behavior is ambiguous.
- Discarding work or rewriting shared history → name exact refs and files, confirm authorization, keep recoverable state. Judge by effect: unstaging a hunk ≠ discarding a worktree.
- Authorized force push → `--force-with-lease` pinned to the inspected remote revision; stop if it moved. Never fetch-and-retry over someone's update.
- Renaming an open PR's head branch closes the PR; a rename means a new PR.

## Pull requests

- Routine inspection, reversible prep, and conflict resolution need no extra permission.
- Authorization is per operation: commit, push, PR, merge, release are separate. No-publish/no-deploy constraints bind.
- Read the PR template. Discover remote and base; don't assume `origin`/`main`.
- Body → `gh ... --body-file <tmpfile>`; never interpolate user content into shell.
- After mutating, verify actual state and report the revision or link; local validation ≠ remote checks.

Descriptions follow [communication](../communication/SKILL.md) and carry only what diff and CI can't. **Max 100 lines**; a small fix needs two.

- Include: line one problem → resulting behavior; why, and the choice over its alternative; what the reviewer must decide or check by hand; risks, limits, migration, checks CI doesn't run.
- Omit: file-by-file lists, restated code, commit narration, CI results, routine test-plan checklists, recaps, empty template sections.
- Before/after or a behavior `diff` over prose. Branch changed → rewrite, don't append.
- The repo has a slow-layer surface script (`pr:surface` in package.json) → its output opens the description, pasted as is, never retyped or summarized from memory: the author's account of what changed is the one with the author's blind spots.
