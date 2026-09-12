# Progress

Living state. Update this every time a task completes and before ending any session. `docs/PLAN.md` holds the full task list with acceptance criteria. This file holds where we actually are.

**Last updated.** 2026-09-12
**Current slice.** Slice 0, Foundation
**Current task.** S0-T01
**Suite status.** not yet running, no source code exists
**Blocked on.** nothing

---

## Slice status

Ninety seven tasks, four gates. Twenty eight tasks to the first working replay.

| Slice | Scope | Tasks | Status | Notes |
| --- | --- | --- | --- | --- |
| S0 | Foundation | 4 | not started | S0-T04 settles the riskiest unknown in thirty minutes |
| S1 | Thread, a real replay against the real app | 24 | not started | Gate Skeleton 1 at S1-T24 |
| S2 | Live perception spike | 2 | not started | Gate Perception at S2-T01. Throwaway, nothing ships |
| S3 | Harden, contract suite, lint, CI, redaction, logging, evidence | 7 | not started | Nothing persists before this slice, which is why it is here and not earlier |
| S4 | Errors, faults, classification, recovery | 13 | not started | The result matrix lives here |
| S5 | Discovery, the live run, the probe review | 15 | not started | Gate Skeleton 2 at S5-T15. S5-T12 is the brief's one hard requirement |
| S6 | Escalation, handoff, the write flow | 15 | not started | Gate Skeleton 3 at S6-T15. Explicitly the thing candidates fake |
| S7 | Deepen, overlays, drift, second tenant, scanner | 10 | not started | S7-T07 and S7-T09 are never cut |
| S8 | Deliverables | 6 | not started | Always runs, wherever the work stopped |
| S9 | Stretch | 1 | not started | Conditional on everything else being green |

## Session log

Append one entry per working session. Newest first. Keep entries to a few lines.

### 2026-09-12
Done: attribution enforced by a commit-msg hook and the six existing commits rewritten clean. Slice 1 recut from forty seven tasks before the first replay to twenty eight.
In flight: nothing.
Decisions: no new ADRs. Four things left Slice 1 for the slice that first needs them, and Harden became its own slice so redaction lands before anything persists.
Surprises: the previous reslice was a rename. It reached the first working replay at task forty seven, which was worse than the layered plan it replaced at forty six.
Next: S0-T01.

### 2026-09-11
Done: repository restructure, git init, ADRs 0011 to 0018, six ADRs superseded, design docs reconciled.
In flight: nothing.
Decisions: eight new ADRs. The ones that changed the shape of the work are 0012 perception, 0014 risk split, 0016 control topology and 0018 outcome probe.
Surprises: a plan review found six recorded decisions with defects that would each have surfaced in the phase that depended on them. The POST to irreversible rule would have forced human confirmation on the primary read capability, and the process topology would have made the escalation requirement unimplementable.
Next: S0-T01, then the rest of Slice 0 in order.

## Open questions

Mirrored from the Open items section of `docs/PLAN.md`.

* How a model chosen ref maps back to an actionable handle. Closed by S0-T04.
* Whether the observation format is enough for a real model on this surface. Closed by S2-T01.
* Whether `member.openSubAccount` is hand authored or discovered by a second live run. Decided at S6-T13.

## Deferred and cut

Mirror into the Cuts section of `REPORT.md` at S8-T02. Format is what, why, what next.

* **The `visual` locator strategy.** Nothing executed it and a schema nothing executes is a guess. Next, it is described in the report as the escape hatch for canvas and desktop surfaces.
* **A model invoking the catalog.** The brief allows one or two stretch goals and this depends on a catalog that is itself conditional. Next, the generated tool schema ships unconditionally at S7-T08.
* **Multi run stability scoring.** A flakiness signal over a handful of local runs is noise. Next, drift recording at S7-T03 carries the useful half.
* **`inputsHash` on the result contract.** Reversible by enumeration for a five digit ID, so it was privacy theatre. Replaced by `inputNames`.
* **The filesystem intervention journal.** It would restore a claim pointing at a browser that died with the process. See ADR 0016.

## Known defects

Anything found and not yet fixed. Each one needs a failing test before the fix, per `docs/TESTING.md` section 1.

* (none yet)

---

## How to update this file

1. Tick the task in `docs/PLAN.md` first. That is the checklist of record.
2. Update the header block here, the five fields at the top.
3. Update the slice table only when a slice's status changes.
4. Append a session log entry.
5. If something was cut, add it to Deferred and cut with a reason. A cut with no reason is indistinguishable from a thing that was forgotten, and the brief grades the difference.
