---
description: Record a new architecture decision
---

Record a decision in `docs/DECISIONS.md`.

1. Read the existing ADRs first. If this decision contradicts one, the new ADR supersedes it and you must mark the old one `Superseded by ADR NNNN`. Do not leave two live ADRs that disagree.
2. Use the template at the bottom of `docs/DECISIONS.md`. Context, decision, consequences, rejected alternatives.
3. Keep it short. If it runs past a page it is two decisions, so split it.
4. State the cost honestly in Consequences. An ADR with no downside listed has not been thought through.
5. Name at least one rejected alternative with the specific reason it lost. Not a strawman.
6. If this decision changes anything in `docs/ARCHITECTURE.md`, `docs/ARTIFACT_SCHEMA.md`, `docs/ERROR_TAXONOMY.md`, `docs/ESCALATION.md`, or `docs/SAFETY.md`, update that document in the same change so the docs never disagree with the ADR log.
