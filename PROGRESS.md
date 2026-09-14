# Progress

Living state, updated once per slice. `docs/PLAN.md` holds the tasks and ticks per task.

**Last updated.** 2026-09-14
**Current slice.** Slice 0, Foundation
**Next task.** S0-T02
**Suite status.** no tests yet, typecheck clean
**Blocked on.** nothing

## Slice status

| Slice | Tasks | Status |
| --- | --- | --- |
| S0 Foundation | 3 | in progress, S0-T01 done |
| S1 Thread | 10 | not started |
| S2 Perception spike | 1 | not started |
| S3 Harden | 5 | not started |
| S4 Discovery | 10 | not started |
| S5 Escalation | 7 | not started |
| S6 Error breadth | 4 | not started |
| S7 Seams | 2 | not started |
| S8 Deliverables, reserved | 4 | not started |

## Session log

Newest first. Earlier detail lives in git history.

### 2026-09-14, reconciliation
Done: nine design documents reconciled to the forty six task plan and its cuts. The detector set became `NoProgress`, `UnclassifiedCondition` and `ModelRequested`. Canonicalisation restored as the fifth generalizer transform.
Decisions: no new ADRs. A scope note in `DECISIONS.md` marks which recorded consequences are now design only. Day estimates removed from the plan.
Surprises: parameterise covered step values only, so a recorded navigate would have stored a member ID.
Next: S0-T02 through gate S1-T10.

### 2026-09-13, replan
Done: S0-T01. The plan consolidated from ninety seven tasks to forty six with the structural cuts applied. The planning document checker deleted.
Decisions: commit ceremony, the PROGRESS cadence and the ADR threshold reduced in `CLAUDE.md`. No new ADRs.

### 2026-09-11 and 2026-09-12
Repository restructure, ADRs 0011 to 0018, attribution hook, two replans.

## Open questions

* **Whether `member.openSubAccount` is hand authored or discovered by a second live run.** Decided at S5-T06.

## Deferred and cut

The full record. `REPORT.md` section 7 is the half page draft in `docs/PLAN.md`, which groups these fourteen entries.

* **Cross tenant reuse, requirement 3.7b.** I designed a capability as a base artifact plus sparse overlays that may override locators and output bindings but never the contract, each tied to a range of base versions. I did not build a second tenant, the overlay merge, or a replay of one tenant's artifact against another. The brief allows 3.7 to be designed rather than built, and the overlay schema is in `docs/ARTIFACT_SCHEMA.md`. Next, a second variant of the target app and a replay that fails with `LocatorNotFound` until an overlay is applied.
* **Drift management across tenants, requirement 3.7c.** Replay records a degradation whenever a lower ranked locator strategy wins, and the `relabel` fault demonstrates it. I did not build the per checkpoint surface fingerprint or the per variant review flag that would turn those records into a managed signal. Next, both, since detection already exists and management is the missing half.
* **Session expiry.** The target app has no expiring session and the executor has no re authentication path. A lapsed session is still detected, by the app profile login redirect, and ends the run as `SessionExpired` rather than recovering. Next, re authentication that restarts from the first step only when every completed step was a read, because resuming a half finished write after a re login risks a double post.
* **Recovery breadth, requirement 3.3f.** The one recovery implemented is `TransientLoad`, which retries a 502 or 503 on idempotent steps and records it even when the run succeeds. Known interstitials and stale element handles are not handled, and their faults were removed from the target app. Every result already carries `recoveries[]`, so adding a handler does not change the contract. Next, the known interstitial handler, the most common real cause of breakage between tenants on one product.
* **Fault coverage.** The target app injects six faults, `flaky503`, `denied`, `surpriseDialog`, `relabel`, `duplicateIds` and `hang`. There is no application error page and no slow load, so `SurfaceUnavailable` is reached only through a 503 on a submit that must not be retried. Validation is still shown, as a declared business outcome of the write flow rather than an injected fault. Next, the error page fault, which reaches that failure class the way a real outage does.
* **Live operator view.** The operator page polls masked screenshots rather than streaming them. It is enough to unblock a flow and poor for anything time sensitive. The control transfer itself is real, on the same session with the same cookies, with forwarded input that is hit tested and recorded. Next, streaming.
* **Learning from the operator.** Each human action during a handoff is recorded in evidence with a locator derived from the element clicked. It is not turned into a draft step on a new revision, so a person unblocking a run does not yet improve the capability, and a discovery run a human had to finish produces no artifact. Next, draft steps marked as human provenance that need approval before they run unattended.
* **Stuck detection, requirement 3.6a.** Three detectors raise an intervention. An observation that does not change across three consecutive actions, a dialog nothing classifies, and the model asking for help. A streak of failed actions and an exhausted recovery are not detected as stuck. Those runs end as typed failures at their step or duration budget, so they reach an engineer rather than an operator. Next, a detector for an exhausted recovery, which would hand a run that retried its way to a dead end to a person instead.
* **Generalization depth.** The generalizer prunes, parameterises, canonicalises paths, infers a checkpoint per step and types outputs. It infers no wait beyond the postcondition race, so a screen that settles after its postcondition first holds, such as a table filling row by row, can be read too early. Next, a stability condition that requires the postcondition to hold across two observations.
* **Version change classification.** Artifacts carry a schema version the engine refuses to exceed, and a capability version. Nothing classifies a change as patch, minor or major. The review step bumps the minor version by rule, because adding a declared outcome is minor by definition. Next, the classifier, once overlays exist to depend on it.
* **Capability catalog.** There is no endpoint listing approved capabilities as callable tools and no demonstration of a model invoking one. The JSON Schema such a catalog would serve is generated. Next, the catalog, the one stretch goal I would pick.
* **Rate limiting and CI.** Nothing limits how fast a run acts against the target app, and there is no CI pipeline. A green local suite is the verification path and the README gives the commands. Next, a throttle through the injected clock, and CI running the same scripts.
* **Automated suite guards.** Coverage thresholds, a lint rule against raw timers and a test that fails when a socket leaves loopback were planned and cut, as tooling about the suite rather than the system. The raw timer rule is checked once by grep before submission. Next, restore them alongside CI.
* **Desktop surface and visual targeting.** The desktop driver is a stub that throws per verb and documents its mapping to UI Automation, which was always the plan. There is no screenshot and coordinate locator strategy, because nothing in the system would have executed one. Next, a visual fallback that escalates rather than clicking, for canvas surfaces.
