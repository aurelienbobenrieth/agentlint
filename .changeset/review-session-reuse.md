---
"@aurelienbbn/agentlint": minor
---

`agentlint review` starts scanning as soon as it listens, shows "Analyzing N files…" with a progress bar instead of a blank loader, and reuses one scan for reloads and decisions until a file some rule can see, or the compared commits, change. Reloading the page or opening the review link again, even from another page, keeps the session: the link now only loads the page, and the page trades its token for the session cookie through `POST /api/session`, so a prefetch or link preview can no longer spend it. A second browser without the cookie is still refused. `@aurelienbbn/agentlint/contract` exports the `ReviewProgress` and `ReviewSessionRequest` schemas for the new `/api/progress` and `/api/session` endpoints.
