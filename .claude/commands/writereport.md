---
description: Assemble REPORT.md from the design documents
---

Write `REPORT.md`, the graded design write up.

Use these seven headings, in this order, with exactly this wording. The brief specifies them and graders read submissions side by side.

1. Architecture
2. Artifact schema
3. Determinism & error handling
4. Heterogeneity & multi-tenant
5. Escalation & handoff
6. Safety
7. Cuts

Rules.
* One to three pages total. A longer report scores worse, not better. Cut before you pad.
* First person singular. A person is submitting this.
* Draw substance from the design docs, but do not copy them. The report is an argument, not a summary. Every paragraph carries a decision or a trade off.
* Every section names at least one thing that was traded away. A report with no costs in it reads as untested thinking.
* Section 7 is about half a page. Start from the draft under Cuts for REPORT section 7 in `docs/PLAN.md`. The full list in `docs/PROGRESS.md` is source material, not the section.
* Follow the writing style rules in `docs/CLAUDE.md` section 10. No em dashes, no en dashes, no hyphens as connectors, `*` for bullets. The headings keep the brief ampersands and the hyphen in multi-tenant, because a graded instruction beats the style rules.

Before writing, re read `docs/ASSIGNMENT.md` section 6 item 2 and section 7 so the report answers what is actually being graded.

Before you finish, grep the file for em dashes and en dashes and remove every one. Split the sentence into two rather than substituting another connector.
