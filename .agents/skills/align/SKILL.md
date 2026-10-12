---
name: align
description: Settle open requirements and domain language before building, by resolving decisions in dependency order and recording shared terms. Use when a request leaves several interdependent decisions open, a domain term is ambiguous or conflicts with the glossary, stated behavior contradicts the code, or the user asks to be questioned on a plan. Not for a single missing answer (ask it inline) or clear tasks (see build).
---

# Align

**Nothing gets built on a silent assumption, and the user only answers what only they can.**

## Questioning

- Map the open decisions as a tree: a decision is askable only once the ones it depends on are settled.
- Look facts up yourself (code, docs, config, history). Ask the user only for decisions and preferences.
- Ask in small batches, each question with your recommended answer and the consequence of each option. The user can accept all with one word, except on a slow layer (below).
- Stated behavior contradicts the code → show both, ask which is intended.
- Done when every branch is decided or explicitly deferred; then summarize the decisions in one table and hand off to [build](../build/SKILL.md).

## Slow layers: the user states first

**A decision that is costly to reverse is the user's to think through, not to approve.** Approving a recommendation builds no understanding of the system; stating a hypothesis does.

A slow layer is a stored data shape, a contract another module or app depends on, an external side effect (email, payment, third-party write), or a new dependency between modules. Everything else keeps the one-word flow.

1. Ask for the user's hypothesis before showing yours: the need, what the end user sees, the data it takes. Five lines, their words.
2. Challenge it with facts: the cases it misses, where it contradicts the code, what already exists that it duplicates.
3. Show your recommendation as a delta against their hypothesis, never as a blank-slate proposal.
4. Record the hypothesis and the settled delta with the decision, so a later review compares the change against what the user expected and inspects only the surprises.

## Show, don't describe

Every question batch and summary uses [communication](../communication/SKILL.md)'s visuals: the decision tree as a `text` tree with the settled branches marked, options on the same fields as a table, a data shape as a small entity sketch (tables, keys, arrows), a flow or lifecycle as arrows. A wall of prose questions is a failed batch.

## Language

- A term used two ways, or clashing with the glossary → name the conflict, propose one meaning, use it from then on in talk, code, and tests.
- Keep the glossary in the repo's existing domain doc; none exists → create `docs/glossary.md` only once a term is actually settled. One line per term: the meaning, and what it is not.
- Record a decision record only when the choice is hard to reverse, would surprise a newcomer, and traded real alternatives. Otherwise the commit message is enough.
