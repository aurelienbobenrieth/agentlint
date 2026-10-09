---
"@aurelienbbn/agentlint": patch
---

Qualify the optional Octane frontend against exactly 0.12.1. Align the peer declaration, runtime version check and consumer smoke tests. Authored scanning uses the bundled editor parser without requiring Octane's optional native parser or TypeScript integration. Other compiler versions fail closed until qualified.

Validate native template comment shells and expose their authored comment semantics rather than synthetic JSX text.
