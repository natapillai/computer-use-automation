---
description: Assemble REPORT.md from the design documents
---

Write `REPORT.md`, the graded design write up.

Use these seven headings, in this order, with exactly this wording. The brief specifies them and graders read submissions side by side.

1. Architecture
2. Artifact schema
3. Determinism and error handling
4. Heterogeneity and multi tenant
5. Escalation and handoff
6. Safety
7. Cuts

Rules.
* One to three pages total. A longer report scores worse, not better. Cut before you pad.
* First person singular. A person is submitting this.
* Draw substance from the design docs, but do not copy them. The report is an argument, not a summary. Every paragraph carries a decision or a trade off.
* Every section names at least one thing that was traded away. A report with no costs in it reads as untested thinking.
* Section 7 comes from the Deferred and cut list in `PROGRESS.md`. Be specific and honest about what is stubbed and what you would build next.
* Follow the writing style rules in `CLAUDE.md` section 10. No em dashes, no en dashes, no hyphens as connectors, `*` for bullets.

Before writing, re read `docs/ASSIGNMENT.md` section 6 item 2 and section 7 so the report answers what is actually being graded.

Before you finish, grep the file for em dashes and en dashes and remove every one. Split the sentence into two rather than substituting another connector.
