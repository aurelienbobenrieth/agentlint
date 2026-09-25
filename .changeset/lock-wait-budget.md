---
"@aurelienbbn/agentlint": patch
---

Store writers now wait up to 10 seconds for a busy `.agentlint/*.lock` instead of about 2 seconds, so concurrent `accept`, `propose`, and outcome writes on a slow machine no longer fail with "The store is locked". An orphaned lock still fails closed, now after the longer wait.
