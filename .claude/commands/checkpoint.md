---
description: Close out a completed task and record state
---

Close out the current task.

1. Run `npm run test` and `npm run typecheck`. If either fails, stop here and fix it. Do not record a task as done on a red suite.
2. Re read the task's acceptance criteria in `docs/PLAN.md`. Confirm each one literally, not approximately. Say which criterion each test covers.
3. Confirm the definition of done in `docs/CLAUDE.md` section 7. Typed boundaries, no `any`, errors as typed values, redaction on anything persisted.
4. Check any document you touched for em dashes and en dashes, per `docs/CLAUDE.md` section 10. Fix anything you find.
5. Tick the task box in `docs/PLAN.md`.
6. If this task closes a slice, update `docs/PROGRESS.md`. Otherwise leave it.
7. If anything was cut or deferred, record it in `docs/PROGRESS.md` under Deferred and cut, with a reason.
8. Write the commit message per `docs/CLAUDE.md` section 11. The five section form only for a design decision, a new mechanism, or a safety property. Otherwise a subject, a one line Change, and a Tests line. No AI attribution trailer of any kind.

Report in five lines or fewer. What got done, what the tests prove, what is next.
