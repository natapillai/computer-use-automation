---
description: Pick up the next task from the plan and start the TDD cycle
---

Start the next task.

1. Read `PROGRESS.md` to find the current phase and task.
2. Read `docs/PLAN.md` and find the first unticked task in phase order. Do not skip ahead to a task that looks more interesting.
3. Read every design document the task references. Do not guess at a design that is already written down.
4. Restate, in three lines, the task ID, its acceptance criteria, and the tests it requires.
5. Check whether anything the task depends on is unfinished. If so, say so and stop rather than building on a gap.
6. Write the failing test first. Run it. Show me the failure and confirm it fails for the intended reason and not because of a missing import or a typo.
7. Only then write the implementation.

If the task is underspecified or turns out to be wrong, stop and say so. Update `docs/PLAN.md`. Write an ADR only if it supersedes an existing one or changes an answer in `REPORT.md`. Do not silently improvise.
