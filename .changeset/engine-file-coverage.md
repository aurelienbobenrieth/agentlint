---
"@aurelienbbn/agentlint": minor
---

Make a complete scan cover the same files on every machine.

Breaking draft changes: `check --all` and explicit globs now list files through Git (`git ls-files --cached --others --exclude-standard`) instead of walking the directory with a fixed skip list. Tracked or unignored files under `dist`, `coverage`, `.cache` or `.agents` at any depth are scanned; files ignored by `.gitignore` are not. Outside a Git work tree, or when the enclosing repository ignores the working directory, the directory walk remains and skips only `node_modules` and `.git`. `.agentlint/.cache/` and config `ignores` are excluded in both modes. Binding `include` and `exclude`, config `ignores`, and explicit globs now match dotfiles and dot directories, so `src/**` covers `src/.hidden/x.ts`.

Normalize line endings once where sources, binding dependencies, fixtures and change snapshots are read. A CRLF checkout and an LF checkout now produce the same fingerprints, snapshot digests and dependency digests. Reported lines do not change. Findings recorded from a CRLF checkout need a new review. A state fixture that names a file it does not supply fails instead of reading an empty source.

Change sets: pass each path to Git as a literal pathspec, so `pages/[id].tsx` no longer collects the hunks of `pages/i.tsx`. Leave submodule entries out. Snapshot a symbolic link as its target text without following it. Apply config `ignores`, binding scope and explicit files before any content is read or diffed, so an ignored large file costs nothing. A binary file or a file above 64 MiB keeps a `git-blob:` digest and no `content` or hunks instead of failing the run.

Never read a file whose real path leaves the repository or enters `.git`: such candidates are skipped in every resolver mode, and a binding dependency that resolves outside the repository fails the run.

Report every file with incomplete or unsupported syntax in one `UnparseableFilesError` after the rest of the scan, still with a failing exit.

Git: reject a base ref that starts with `-`, run with `--no-optional-locks` and the `C` locale, explain a shallow clone and a missing default branch with the fix (`fetch-depth: 0`, `--base`, or the config `base` key), report a missing `git` executable instead of "no default branch", and stop wrapping Git failures in a second "Git error" prefix. Finding, file and fixture order no longer depends on the host locale. On POSIX a backslash in a file name is kept.

When the working directory has no config but an ancestor does, the error names that directory instead of suggesting a second `.agentlint/config.ts`.
