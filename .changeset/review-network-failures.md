---
"@aurelienbbn/agentlint": patch
---

Make review network, malformed response, and browser storage failures recoverable. Bound local HTTP requests to 30 seconds, editor discovery to five seconds per probe, and Git comparisons to two minutes per command. Propagate cancellation to HTTP and Git operations and use the Effect clock when recording decisions. Preserve syntax highlighting cache separation with an escaped NUL character that source parsers can read.
