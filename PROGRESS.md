# Progress

Living state. Update this every time a task completes and before ending any session. `docs/PLAN.md` holds the full task list with acceptance criteria. This file holds where we actually are.

**Last updated.** not started
**Current phase.** Phase 0, Foundation
**Current task.** P0-T01
**Suite status.** not yet running
**Blocked on.** nothing

---

## Phase status

| Phase | Scope | Status | Notes |
| --- | --- | --- | --- |
| P0 | Foundation, tooling, CI | not started | |
| P1 | Core domain, zero IO | not started | Largest phase. Schema quality is the top graded item |
| P2 | Target app fixture | not started | Timebox it. It is a fixture, not the deliverable |
| P3 | Surface layer and contract suite | not started | |
| P4 | Control plane | not started | |
| P5 | Deterministic replay | not started | The thirteen row error matrix lives here |
| P6 | Discovery | not started | |
| P7 | Escalation and handoff | not started | Explicitly the thing candidates fake. Build it for real |
| P8 | Evidence and the live run | not started | P8-T03 is the brief's one hard requirement |
| P9 | Stretch | not started | Do not start before P0 to P8 and P10 are green |
| P10 | Deliverables | not started | |

## Session log

Append one entry per working session. Newest first. Keep entries to a few lines.

```
### YYYY-MM-DD
Done: P0-T01, P0-T02
In flight: P0-T03
Decisions: none
Surprises: none
Next: P0-T03 then P0-T04
```

*(no sessions yet)*

## Open questions

Things that need a decision but are not blocking yet. Move to an ADR when decided.

* (none yet)

## Deferred and cut

Mirror into the Cuts section of `REPORT.md` at P10-T02. Format is what, why, what next.

* (none yet)

## Known defects

Anything found and not yet fixed. Each one needs a failing test before the fix, per `docs/TESTING.md` section 1.

* (none yet)

---

## How to update this file

1. Tick the task in `docs/PLAN.md` first. That is the checklist of record.
2. Update the header block here, the four fields at the top.
3. Update the phase table only when a phase's status changes.
4. Append a session log entry.
5. If something was cut, add it to Deferred and cut with a reason. A cut with no reason is indistinguishable from a thing that was forgotten, and the brief grades the difference.
