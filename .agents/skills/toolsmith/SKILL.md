---
name: toolsmith
description: Build scripts, CLIs, scaffolds, smoke checks, and environment doctors that are safe to rerun, exit honestly, and never escape their target. Use when writing or changing a reusable script or tool that replaces repeated manual work or fragile verification. Not for one-off commands, or for deciding which mechanism should own a problem (see retrospect).
---

# Toolsmith

Extend an existing script, CI step, or check before adding one.

- Unsure a script is the right owner → [retrospect](../retrospect/SKILL.md) routes it. Repeated file creation → scaffold with conflict check and preview.
- Task-only probe stays temporary; promote only with recurring value and an owner.
- Before coding, fix inputs, targets, side effects, success evidence, failure behavior. No new orchestration layer.

## Safety

- Writers: check conflicts first and never overwrite silently; preview must reflect the real plan; re-verify preconditions before writing.
- Bound retries, requests, timeouts, child-process lifetime. Retry only idempotent operations; a lost response can follow a successful write.
- Partial run → report what completed and how to recover; never exit success.
- Input is data: argument arrays, no shell strings from input. Before destructive ops, verify resolved paths stay inside the target, including symlink/junction escapes.

## Exit codes and output

- Exit 0 only when the promised check or operation completed.
- Distinguish invalid config, violation, skipped check, tool crash, transient failure, missing authorization. Empty input set must not certify coverage.
- Machine output on stdout, diagnostics on stderr. Redact credentials, private payloads, secret URLs. Include target and version when they bound the result.
- Doctor: name the missing prerequisite and its repair command; run authorized local repairs. Never mask stale generated contracts with handwritten or widened types.

## Validate

- Test normal use, a meaningful failure, and rerun/recovery. Writers: temp fixtures proving conflict preservation and preview. Process runners: nonzero exits, cleanup.
- Document at the existing entry point. CI only if deterministic, cheap, meant as a gate.
- Delete the manual steps it replaces.
