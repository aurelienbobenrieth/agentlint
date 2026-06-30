# Audit Decisions

## 2026-06-26 - ACCEPTED - Ban TypeScript non-null assertions

- Issue: Production and test code used TypeScript non-null assertions, bypassing `noUncheckedIndexedAccess`.
- Mechanism: oxlint rule.
- Rule id: `typescript/no-non-null-assertion`.
- Outcome: Accepted and enforced as an error in `.oxlintrc.json`; all 11 existing violations were fixed.

## 2026-06-26 - DECLINED - Avoid splitting subprocess command strings into arguments

- Issue: Git subprocess arguments were built by splitting a command string, including a user-controlled `--base` ref path.
- Mechanism proposed: oxlint JS custom rule.
- Rule id proposed: `agentlint/no-string-split-child-process-args`.
- Reason: User requested next without approving this proposal.

## 2026-06-26 - ACCEPTED - Ban explicit any and rely on noImplicitAny

- Issue: Source code permitted explicit `any`, weakening the strict typing contract at Effect boundaries.
- Mechanism: oxlint rule plus existing TypeScript strict mode.
- Rule id: `typescript/no-explicit-any`; implicit `any` remains enforced by `strict: true`.
- Outcome: Accepted with modification and enforced as an error in `.oxlintrc.json`; both existing explicit `any` sites were fixed.

## 2026-06-26 - ACCEPTED - Require schema decoding for JSON parsing

- Issue: JSON strings were parsed without schema decoding at package metadata and test boundaries.
- Mechanism: oxlint JS custom rule.
- Rule id: `effect/no-raw-json-parse`.
- Outcome: Accepted and enforced as an error via `scripts/oxlint-plugin-effect.js`; raw package metadata and JSONL parses now use `Schema.fromJsonString`.
