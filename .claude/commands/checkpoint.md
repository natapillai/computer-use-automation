---
description: Close out a completed task and record state
---

Close out the current task.

1. Run `npm run test` and `npm run typecheck`. If either fails, stop here and fix it. Do not record a task as done on a red suite.
2. Re read the task's acceptance criteria in `docs/PLAN.md`. Confirm each one literally, not approximately. Say which criterion each test covers.
3. Confirm the definition of done in `CLAUDE.md` section 7. Typed boundaries, no `any`, errors as typed values, redaction on anything persisted.
4. Check any document you touched for em dashes and en dashes, per `CLAUDE.md` section 10. Fix anything you find.
5. Tick the task box in `docs/PLAN.md`.
6. Update `PROGRESS.md`. The four header fields, the phase table if the phase status changed, and a session log entry.
7. If anything was cut or deferred, record it in `PROGRESS.md` under Deferred and cut, with a reason.
8. Write the commit message using the exact five section format in `CLAUDE.md` section 11. Issue, Change, Why, Tests, Metrics. All five present. `Metrics` says `none` when there are none. No AI attribution trailer of any kind.

Report in five lines or fewer. What got done, what the tests prove, what is next.
