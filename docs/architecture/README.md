# Architecture

The repository is organized by ownership first and role second. A reader should be able to infer a module's direction
from its path:

- `domain/` contains value contracts and pure domain behavior.
- `shared/pipeline/` coordinates detection without depending on product features.
- `shared/infrastructure/` owns process, filesystem, Git, and persistence adapters.
- `features/<name>/` colocates a use case's request, handler, and tests.
- `apps/review/features/<name>/` owns one review UI capability; `apps/review/shared/` cannot import a feature.
- Prefer a folder for a multi-part concern (`git/command.ts`, `git/service.ts`, `rule/context/model.ts`) instead of
  encoding hierarchy in a dashed or dotted filename. Apply that pattern when a concern is added or structurally
  refactored; a single cohesive leaf may remain one file.

`pnpm architecture:check` resolves the production import graph and rejects cycles and forbidden reverse dependencies.
`pnpm architecture:graph` regenerates [dependencies.mmd](./dependencies.mmd), an area-level Mermaid graph. The graph is
intentionally coarse: file-level graphs hide boundaries in noise.

Imports should point entrypoints → features → adapters/pipeline → domain. Infrastructure and pipeline
may both depend on domain; infrastructure may not depend on the application pipeline. The review contract is a special
browser-safe boundary and may depend only on Effect. The composite Action is standalone and may use only local modules
and Node built-ins at runtime.
