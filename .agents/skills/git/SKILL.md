---
name: git
description: Git workflow skill covering conventional commits, intelligent staging, pull requests, and gh CLI usage. Use when committing, creating PRs, or managing git history.
---

# Git

## Commits

### Grouping

- Group changes into cohesive commits by unit of work: one commit per logical change that could be deployed, reverted, or cherry-picked independently.
- When a diff spans multiple concerns (feature + refactor, fix + test, rename + behavior change), split into separate commits. Stage files selectively with `git add <paths>`.
- Ask yourself: "if this commit were reverted, would exactly one coherent thing disappear?" If not, split it.

### Conventional Commit Format

```
<type>[scope]: <description>

[body]

[footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

- Derive type and scope from the diff, not from the user's words.
- Description: imperative mood, present tense, under 72 chars. "add", not "added" or "adds".
- Body: explain *why*, not *what*. The diff already shows the what.
- Breaking changes: add `!` after type/scope and a `BREAKING CHANGE:` footer.
- Reference issues in the footer: `Closes #123`, `Refs #456`.

### Authoring

- Read author name and email from `git config user.name` and `git config user.email`. Use those values exclusively.
- Add `Co-Authored-By` trailer for the current LLM when it contributed to the change.

### Safety

- Read `git diff --staged` (or `git diff` when nothing is staged) and `git status --porcelain` before committing.
- Stage files explicitly by path. Avoid `git add -A` or `git add .` to prevent leaking secrets or binaries.
- Leave hooks enabled. When a hook fails, fix the issue and create a new commit - never amend the failed one.
- Reserve destructive commands (`--force`, `reset --hard`, `clean -f`, `branch -D`) for explicit user requests.

## Pull Requests

### Title

- Use conventional commit format: `<type>[scope]: <description>`.
- Keep under 70 characters. Put detail in the body.

### Body

```
## Summary
<1-3 bullet points explaining why this change exists>

## Changes
<Bullet list of what changed, grouped logically>

## Test plan
<How to verify correctness>
```

- Write the summary from all commits on the branch, not just the latest one.
- Link related issues: `Closes #N`, `Refs #N`.

## gh CLI

- Use `gh pr create --title "..." --body "..."` with a heredoc for multi-line bodies.
- Use `gh pr view`, `gh pr checks`, `gh pr merge` for PR lifecycle management.
- Use `gh issue list`, `gh issue view` for issue context before writing PR descriptions.
- Push with `git push -u origin HEAD` before creating a PR when the remote branch is missing.
