# Strategies beyond examples

Load when a row in the testing skill points here. Each needs a reason the example tests can't cover.

## Properties

- For real laws: normalization is idempotent, totals are preserved, ordering holds, bounds hold, a lossless round trip returns the input. Define the valid domain and the relation before the generator.
- Round trips can pass with encoder and decoder sharing one mistake; pair them with a few known encodings. Lossy transforms have no round trip.
- Traps: heavy filtering, generators that never reach the risky region, an oracle that reimplements the algorithm.
- Build generated values through the domain's constructors, and keep the generator next to that domain module.
- Keep the seed and shrink path; turn a found failure into a named example.

## State models

- For sequences: retry after partial completion, cancel then resume, duplicate events, ownership changes.
- The model is simpler than the implementation and asserts observable state after each command. A few independent branches don't need one.
- A sequential model doesn't prove races. Ordering risk → controlled interleavings or the real concurrency boundary, bounded and replayable.

## Contracts

- List the fake's assumptions. Run one shared suite against the fake and against a disposable real instance, authoritative fixture, or authorized sandbox. Label what the real side proves.
- Published package: pack it, install it in a clean consumer, import only public entry points. Workspace resolution hides install defects.

## Mutation

- Scope to changed logic or a suspiciously green suite; never chase a repo-wide score.
- Classify each survivor before touching tests: missing behavior, weak assertion, unreachable code, equivalent mutant, or test-selection gap.
- The score is a diagnostic, not proof the product works.
