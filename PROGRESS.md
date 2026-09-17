# Progress

Living state, updated once per slice. `docs/PLAN.md` holds the tasks and ticks per task.

**Last updated.** 2026-09-17
**Current slice.** Slice 5, Escalation
**Next task.** S5-T01
**Suite status.** 386 unit tests across 54 files, 45 integration tests across 9 files and 5 e2e tests across 2 files passing, typecheck clean
**Blocked on.** nothing

## Slice status

| Slice | Tasks | Status |
| --- | --- | --- |
| S0 Foundation | 3 | done |
| S1 Thread | 10 | done |
| S2 Perception spike | 1 | done |
| S3 Harden | 5 | done |
| S4 Discovery | 10 | done |
| S5 Escalation | 7 | not started |
| S6 Error breadth | 4 | not started |
| S7 Seams | 2 | not started |
| S8 Deliverables, reserved | 4 | not started |

## Session log

Newest first. Earlier detail lives in git history.

### 2026-09-17, Slice 4 closed at Gate 2, Skeleton 2
Done: S4-T01 to S4-T10. Claude Sonnet 5 drove MERIDIAN Core to the savings balance in five model calls and three actions, and that run is committed as `evidence/discovery/run_56fc6b06.../` with its trace, its redacted transcript, masked captures of the first and final screens, and the draft it produced. The generalizer turned the run into `capabilities/member.readSavingsBalance@1.0.0.json` through five transforms. The negative probe review replayed that draft with `00000`, stopped at the failed postcondition, derived the `MEMBER_NOT_FOUND` detector from the real banner and emitted `1.1.0`. Three commands exist, `npm run discover`, `npm run review` and `npm run replay`, and none of them takes an input value as an argument. The whole thread runs offline from the exchange the live run recorded.
Decisions: no new ADRs. A business outcome exits 0 at the replay CLI, because an exit code is the first thing a caller branches on and a non zero code there would conflate an answer with a failure. Review writes nothing until a second replay of the reviewed version returns the outcome, so a detector that does not work never reaches an artifact. Replay evidence is filed by outcome once the outcome is known, which is what `docs/EVIDENCE.md` describes. Discovery requests and reviews are committed files under `requests/`, because a goal and an outcome name are reviewable configuration and a value belongs in neither.
Surprises: the live run exposed two defects in its own evidence, an absolute local path in the log and the allowlist email pattern matching the `id@version` file name. Both are fixed forward and the evidence is committed unedited, because a second paid run would break the one live run rule. The persisted projection of a result kept `amountMinor` after hiding the raw text, so a stored balance was still a balance, now replaced whole. The live run's observation hashes and refs matched the S2-T01 spike exactly, which is the stability ADR 0017 relies on, observed twice.
After Gate 2, on the project owner's instruction: discovery was run live a second time on the fixed pipeline as `run_84705a0a`, and both runs are kept. The first is the record of the system surfacing defects in its own output, the second is what the README and `REPORT.md` point at, and `evidence/README.md` explains the pair. The artifact lineage, the review, the cassette and both replays were regenerated from the second run so one thread is committed rather than two halves. The project owner approved `1.1.0` under the handle `nata`. Observation hashes are identical across all three live runs, the spike, the first and the second, which is worth a line in `REPORT.md` because it is what ADR 0017 relies on.

Next: S5-T01.

### 2026-09-15, Slice 3 closed, Harden
Done: S3-T01 to S3-T05. One SurfaceDriver contract suite passes on the fake and the web driver. The Redactor and sensitivity propagation redact provenance first and patterns second. The evidence sink redacts every text byte at the sink, writes a manifest with redaction counts and never values, and takes screenshots that Playwright masks before the bytes exist, which a pixel test proves inside the content frame. The MERIDIAN Core profile classifies routes and marks sensitive fields, and the network guard enforces it per step. The evidence scanner guards evidence, capabilities and cassettes, and the pre Harden exclusions are gone.
Decisions: the project owner chose enforcement at the network guard per step, recorded as an amendment to ADR 0014. While a step runs, a request the profile does not list is refused and a write is refused under a read step, so the step fails as `PolicyDenied` before the write lands. Integration files now run one at a time, which the project owner chose as the test of whether the second integration failure was contention, and two serial runs passed. The S2-T01 spike cassette passed the scanner and is committed, so S4 loop development runs offline.
Surprises: the committed phone pattern swallowed the space before a number, and is fixed in the allowlist and SAFETY. A bash heredoc on this machine collapses double backslashes, which a count check in the edit script caught before anything changed. The integration failure recurred with seven files in parallel, as a 5 second frameset load timeout in broker sessions rather than a 30 second hang, and did not recur serially.
Next: S4-T01.

### 2026-09-15, Slice 2 closed, the live spike passed
Done: S2-T01. Claude Sonnet 5 reached the savings balance of member 10001 in five model calls and four actions. It filled the member ID field by input name, clicked the td Search cell, clicked the member link, extracted the balance cell and called done. Checked in code, the extracted element was the cell right of Savings and its text parsed as 425075 minor units of USD. Estimated cost two cents. The prompt was not iterated.
Guards: confirmed in code before the run by an offline self check with no API call. A budget of three aborted after exactly three requests. A thrown API error ended the run after one request, and the live client is built with maxRetries 0. The rendered observation carried no seeded canary, and the unredacted render tripped the canary check, so the check is known to work.
Decisions: no new ADRs. The S1-T08 observation format needed no change. The spike leased its session through the broker and `GuardedSurface` rather than running with no policy, so the network guard applied. Prompt redaction previewed S3-T02 and the S3-T04 field map, with provenance first, so the member's own ID reaches the model only as `{{inputs.memberId}}`.
Surprises: the self check caught two bugs before any spend. Redacting by field map before provenance hid the result link the model needs. Adjacent cells in a collapsed border table share a pixel, which put the Account column below the Balance header. The second was a core geometry bug and is fixed with a test.
Cassette: `tests/fixtures/cassettes/discovery.readSavingsBalance.json`, five exchanges, gitignored until S3-T05. It drives loop development offline while S4-T03 keeps the spike's tool names and observation text. S4-T08 remains the one deliberate live run and records the cassette S4-T10 uses.
Next: S3-T01.

### 2026-09-14, Slice 1 closed at Gate 1
Done: S1-T01 to S1-T10. The hand authored `member.readSavingsBalance` replays through the session broker, `GuardedSurface` and the web driver against MERIDIAN Core. It returns 425075 minor units of USD for member 10001, and `MEMBER_NOT_FOUND` for 00000 without waiting out the step timeout.
Decisions: no new ADRs. `SurfaceDriver` gained `match`, `frameUrl` and `waitForChange`, recorded in `docs/ARCHITECTURE.md`. The wait is a race over `waitForChange`, recorded in `docs/ERROR_TAXONOMY.md` section 7. A target app reset keeps sessions, recorded in `docs/TARGET_APP.md`.
Surprises: Playwright reissues refs per snapshot, and after a navigation an old ref named the card number cell. The driver now checks role, name and frame against a fresh snapshot before acting. Playwright 1.63 has no mutation polling mode and failed the call at once, which made every wait a busy loop until a test caught it. The driver polls a mutation counter on animation frames instead. Chromium loads its own error page after a blocked navigation, and that load interrupts the next navigation on the same page.
Next: S2-T01, the live model spike.

### 2026-09-14, Slice 0 closed
Done: S0-T02, the injected clock, id provider and env config. S0-T03, the perception spike, passed all five failure conditions using public Playwright API, `ariaSnapshotJSON` in `ai` mode with `aria-ref` locators. The hostile page it ran against is now the first file of `apps/target`.
Decisions: no new ADRs. ADR 0011 amended because Claude Sonnet 5 rejects a temperature parameter. ADR 0012 amended with the spike result.
Surprises: two premises were wrong. Chromium did not flatten the layout tables, and the non semantic control is a cell named by its text rather than a nameless node. Geometry stays the relation mechanism regardless. The first spike run reported a false F5 failure, caused by the spike reading a cursor property as text, and was re-run after the fix.
Next: S1-T01 through gate S1-T10.

### 2026-09-14, reconciliation
Done: nine design documents reconciled to the forty six task plan and its cuts. The detector set became `NoProgress`, `UnclassifiedCondition` and `ModelRequested`. Canonicalisation restored as the fifth generalizer transform.
Decisions: no new ADRs. A scope note in `DECISIONS.md` marks which recorded consequences are now design only.

### 2026-09-11 to 2026-09-13
Repository restructure, ADRs 0011 to 0018, attribution hook, replans down to forty six tasks, S0-T01.

## Open questions

* **What `contextual` means on a redaction pattern.** No document defines it. The redactor applies a contextual pattern everywhere, which over redacts and fails closed. Decide whether it narrows to a nearby keyword before any real account data is in scope.
* **Whether `member.openSubAccount` is hand authored or discovered by a second live run.** Decided at S5-T06.
* **What demonstrates the lifecycle gate.** `1.1.0` is approved, and both committed replays record that they ran against an approved version. The gate approval actually unlocks, unattended replay of a `write` step without confirmation, is still undemonstrated, because this capability is read only and `authorize` lets every read through whatever the lifecycle says. `member.openSubAccount` at S5-T06 is where that gets exercised.

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
