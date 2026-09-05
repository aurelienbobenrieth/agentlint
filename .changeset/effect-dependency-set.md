---
"@aurelienbbn/agentlint": patch
---

Pin `@effect/platform-node-shared` alongside `effect` and `@effect/platform-node` so npm and yarn install a single `effect` copy. A caret range on the transitive package could resolve to a newer prerelease and load two Effect runtimes, which crashed the CLI at startup.
