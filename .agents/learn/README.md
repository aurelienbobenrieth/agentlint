# Learned Notes

Use this directory for rare, expensive debugging knowledge that should be searchable by future agents without entering base context.

Before re-solving a weird, repeated, dependency-specific, or platform-specific issue, search here:

```bash
rg "<symptom-or-library>" .agents/learn
```

Write a note only after non-obvious investigation. Keep it short and focused on symptoms, cause, fix, and verification. Do not store agentlint finding dispositions here; those belong in `.agentlint/ledger.jsonl`.
