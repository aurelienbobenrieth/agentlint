---
"@aurelienbbn/agentlint": minor
---

Harden repository-owned review decisions and their evidence.

Breaking draft changes: state and change fingerprints now use version 2 and preserve exact Unicode. State findings include their containing file structure, structural occurrence and explicit binding dependencies. Version 1 fingerprints remain readable but require a new review. Review artifacts use version 2 with shared source snapshots and visible coverage. Regenerate older artifacts. The public testing API exposes promise helpers, including `testRuleOnSources`, instead of engine services and Effect runners.

Prevent lineage collisions from deleting independent decisions, reject incomplete scans and malformed rules, support typed detector options, and make persistence atomic with a cross-process transaction lock. Requesting changes revokes an existing decision. Detached exports support conditional revocations through `acceptances import`.

Use complete finding identities for GitHub selectors, share fixture and production state execution, correct compact change-fixture hunks, release parser resources, avoid full change evidence for state-only scans, bound concurrent Git subprocesses, and generate review artifacts from the original scan. Improve authoring guidance, package validation and platform checks.

Fail on incomplete source syntax and paths outside the repository. Calibration cannot mutate acceptances. Reject `pull_request_target` in the bundled action and document executable configuration and artifact confidentiality.

Pre-v1 cleanup: accept only complete finding identity hashes as digest selectors. Attached review drafts record decisions only after server confirmation, serialize submissions, and prevent finishing during a pending action. Calibration reports calibration progress instead of gate authority.
