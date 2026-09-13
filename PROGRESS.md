# Progress

Living state. Update this every time a task completes and before ending any session. `docs/PLAN.md` holds the full task list with acceptance criteria. This file holds where we actually are.

**Last updated.** 2026-09-13
**Current slice.** Slice 0, Foundation
**Current task.** S0-T01
**Suite status.** not yet running, no source code exists
**Blocked on.** nothing for S0-T01. A real deadline for the forecast, see Open questions

---

## Slice status

Ninety seven tasks, four gates, thirty six focused days through Slice 8 at an unmeasured pace. S1-T24 re-forecasts from measured hours.

| Slice | Scope | Tasks | Days | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| S0 | Foundation | 4 | 1.5 | not started | S0-T04 is a go or no go on ADR 0012 against five named failures |
| S1 | Thread, a real replay against the real app | 24 | 4 | not started | Gate Skeleton 1 at S1-T24, where the forecast is redone |
| S2 | Live perception spike | 2 | 1 | not started | Gate Perception at S2-T01. Throwaway, lives in `scratch/`, never committed |
| S3 | Harden, contract suite, lint, CI and guards, redaction, logging, evidence, scanner | 8 | 3 | not started | Nothing is committed before this slice. S3-T08 lifts the rule |
| S4 | Errors, faults, classification, recovery | 13 | 5.5 | not started | The result matrix lives here |
| S5 | Discovery, the live run, the probe review | 15 | 7.5 | not started | Gate Skeleton 2 at S5-T15. S5-T12 is the brief's one hard requirement |
| S6 | Escalation, handoff, the write flow | 15 | 7.5 | not started | Gate Skeleton 3 at S6-T15 |
| S7 | Deepen, overlays, drift, second tenant, desktop stub, schema | 9 | 3.5 | not started | S7-T07 and S7-T08 are never cut |
| S8 | Deliverables | 6 | 2.5 | not started | Always runs, wherever the work stopped |
| S9 | Stretch | 1 | 0.5 | not started | Conditional on everything else being green |

## Session log

Append one entry per working session. Newest first. Keep entries to a few lines.

### 2026-09-13
Done: the pre Harden rule made enforceable in `.gitignore`. S0-T04 given five named failure conditions and a costed plan B. A full sweep of task ID references. A forecast in days.
In flight: S0-T01.
Decisions: no new ADRs. The evidence scanner moved into Harden as S3-T08. Task IDs are frozen from S0-T01 onward.
Surprises: ADR 0012 cited retired S0-T08 for three commits, and retired S0-T08 was sensitivity propagation. The ID was live, so a dead ID grep would never have caught it. Three more live but wrong references sat in the CLAUDE.md commit examples. The recut also dropped two responsibilities with no owner, the coverage gates and the loopback guard, now in S3-T03. The forecast is thirty six days, which the brief's own framing does not accommodate.
Next: S0-T01.

### 2026-09-12
Done: attribution enforced by a commit-msg hook and the existing commits rewritten clean. Slice 1 recut from forty seven tasks before the first replay to twenty eight.
In flight: nothing.
Decisions: no new ADRs. Four things left Slice 1 for the slice that first needs them, and Harden became its own slice so redaction lands before anything persists.
Surprises: the previous reslice was a rename. It reached the first working replay at task forty seven, worse than the layered plan it replaced at forty six.
Next: S0-T01.

### 2026-09-11
Done: repository restructure, git init, ADRs 0011 to 0018, six ADRs superseded, design docs reconciled.
In flight: nothing.
Decisions: eight new ADRs. The ones that changed the shape of the work are 0012 perception, 0014 risk split, 0016 control topology and 0018 outcome probe.
Surprises: a plan review found six recorded decisions with defects that would each have surfaced in the phase that depended on them.
Next: S0-T01.

## Open questions

* **The deadline.** The message that was meant to set it still had its placeholder in it. Until a real date replaces it, every forecast is measured against the brief's own framing of a focused effort that should not eat a month, taken as roughly twenty working days. At thirty six forecast days that does not fit, and a proposed cut is waiting for a decision.
* How a model chosen ref maps back to an actionable handle, and whether ADR 0012 survives at all. Closed by S0-T04.
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
