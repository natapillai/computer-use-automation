---
description: Self review the repository against the brief and the evaluation criteria
---

Review the repository as a Principal Engineer who did not write it and is reading it alongside two other submissions.

1. Walk `docs/REQUIREMENTS.md` row by row. For each, name the code that satisfies it and the test that proves it. Flag every row where you cannot point to both. Do not accept intent as evidence.
2. Re read `docs/ASSIGNMENT.md` sections 3, 6, and 7. Find anything the traceability matrix itself has missed.
3. Check the evaluation criteria in brief order. System design, core loop correctness, robustness, escalation, generalisation, safety, code quality, communication. For each, say what a grader would actually see when they open the repo.
4. Look specifically for the failure modes the brief names.
   * Business outcomes conflated with failures.
   * Escalation that is a TODO rather than a mechanism.
   * A discovery run that is described rather than evidenced.
   * Locator strategies that would not survive a legacy surface.
   * Scaling infrastructure that was built despite being explicitly not rewarded.
5. Check that every stub is documented as intentional, sits on a real seam, and appears in the Cuts section.
6. Name the three weakest things in the repository and what you would do about each.

Be blunt. Flattery here costs marks later.
