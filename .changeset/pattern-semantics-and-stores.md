---
"@aurelienbbn/agentlint": patch
---

Make declarative patterns mean what they say. A placeholder that appears twice must capture the same code, so `$A === $A` no longer matches `x === y`. A rule whose matches overlap reports each node once, under the first declared match that applies, instead of failing with a duplicate finding key. A property constraint such as `notHas: "take: $_"` accepts the shorthand `{ take }` and no longer reads a property nested in another property's value as an option of the matched call. A complete `check` removes proposals whose finding is gone, proposal writes are locked and atomic like acceptance writes, a config can import `@aurelienbbn/agentlint/calibration` without an install, and the review server starts an editor without waiting for it to exit. The GitHub action suspends workflow command processing while it prints CLI output, passes the head branch as a full ref, and runs `install: true` on Windows runners.
