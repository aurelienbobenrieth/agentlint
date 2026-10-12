---
"@aurelienbbn/agentlint": minor
---

A detector that reports unusable evidence now fails with a `DetectorContractError` that says what is wrong and where, instead of `Cannot create fingerprint: the value is not canonical JSON data` (#75). A change detector without `evidence` fails with `reported invalid evidence: change detectors must report evidence`, and evidence that is not plain JSON names the value and its path, e.g. `only plain objects can be canonicalized: Date at $.createdAt`.

`DetectorContractError` gains the `invalid_evidence` reason. Code that switches over every reason needs a case for it. Fingerprints are unchanged.
