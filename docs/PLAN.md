# Implementation plan and master checklist

The single source of truth for what is left to build. Tick a box when its acceptance criteria are met and `npm run test` plus `npm run typecheck` are green. `PROGRESS.md` updates once per slice.

## Rules

* **Task IDs.** This consolidation, from ninety seven tasks to forty six, is the last renumbering. S0-T01 kept its ID because work exists against it. From here a moved task keeps its ID and a removed one stays in place, struck through. An ID written as `retired S0-T08` is deliberate history. One grep at S8-T03 checks references before submission.
* **Nothing is committed before Harden.** Nothing produced by running code or a model is committed until Slice 3 closes. That covers spike output, transcripts, screenshots, generated artifacts, cassettes and `evidence/`. Hand written source, tests, fixtures and synthetic seed data are inputs and are committed as they land. `.gitignore` enforces the rule, and S3-T05 lifts the exclusions in the same commit that turns on the scanner. `scratch/` stays ignored.
* **The tail is reserved.** Slice 8 has three days and is never spent building. Wherever building stops, Slice 8 runs.
* **Uncuttable.** The live discovery run, the business outcome split, a real control transfer on the same session, the artifact schema, the sub account write flow, and `REPORT.md`.

## Order

Uncuttable work lands first, so a time stop removes breadth rather than a requirement. Thread, then the perception spike, then Harden because Discovery commits evidence, then Discovery, then Escalation with the write flow, then error breadth, then the seams, then the reserved tail.

## Forecast

A day is six focused hours, excluding review. One data point is measured. S0-T01 overran its estimate on an npm resolver defect. S1-T10 re-forecasts every remaining slice from measured hours.

| Slice | Tasks | Days | Cumulative | Gate |
| --- | --- | --- | --- | --- |
| S0 Foundation | 3 | 1 | 1 | |
| S1 Thread | 10 | 3.5 | 4.5 | Skeleton 1 at S1-T10 |
| S2 Perception spike | 1 | 0.75 | 5.25 | Perception at S2-T01 |
| S3 Harden | 5 | 2 | 7.25 | |
| S4 Discovery | 10 | 7.5 | 14.75 | Skeleton 2 at S4-T10 |
| S5 Escalation | 7 | 6.5 | 21.25 | Skeleton 3 at S5-T07 |
| S6 Error breadth | 4 | 2 | 23.25 | |
| S7 Seams | 2 | 0.75 | 24 | |
| S8 Deliverables, reserved | 4 | 3 | 27 | |

## Against ten days

The floor for this plan, with every cut applied, is twenty seven days. Twenty four are building and three are the reserved tail. Ten days is not reachable at the forecast pace, and no reordering changes that.

Ten days leaves seven for building, and day seven is the close of Harden. Exactly what that breaks:

* **The live discovery run does not happen.** Discovery starts on day 7.25. This is the brief's one stated hard requirement, so a ten day stop fails the submission outright.
* **The business outcome split is never demonstrated.** It lands at S4-T01 and is proven at S4-T10.
* **There is no escalation and no control transfer.** Slice 5 starts on day 14.75.
* **There is no write flow**, so requirement 3.4 is unproven.
* **What exists on day seven** is a hand authored artifact replaying against the live app, a perception result, redaction and the scanner. That is a replay engine, not the system the brief describes.

The shortest path to the live run alone, skipping everything off its direct path, is about nine and a half building days, already past the seven that ten days allows.

The uncuttable set by itself, with all breadth removed, is about seventeen building days, so twenty with the tail. That is the true floor for a submission that meets the brief. The choice is between about twenty days with breadth cut further, and twenty seven for this plan. The re-forecast at S1-T10, on day 4.5, replaces these numbers with measured ones before either is committed to.

---

## Slice 0. Foundation

* [x] **S0-T01** Repo skeleton, `package.json`, TypeScript strict, ESM, Node 22, Vitest.
  * Accept: `npm run typecheck` passes on an empty `src` and `npm run test` passes with no tests. The tree matches `CLAUDE.md` section 4 except the output directories the pre Harden rule keeps out of git. Each script lands with the task that makes it work.
* [ ] **S0-T02** `Clock`, `IdProvider` and Zod validated env config.
  * Accept: one `Clock` with `now()` and `delay(ms)`, the only sanctioned delay. No secret has a default. `ANTHROPIC_MODEL` lives in config, per ADR 0011.
  * Test: unit, seeded providers are deterministic, and a missing required variable fails with a named message.
* [ ] **S0-T03** Perception viability spike, half a day. Answers whether ADR 0012 survives the surface built to defeat it.
  * Accept, the page. A frameset with `nav`, `content` and `status` frames. In `content`, a nested table form with an input labelled only by a sibling `<td>` reading `Member  ID:`, a second labelled input one row below, and a `<td onclick>` submit with inner text only. It is written as the first file of `apps/target`, not as throwaway, and S1-T06 grows the target app from it. The spike script and its output stay in `scratch/`.
  * Accept, the mechanism. Aria-ref resolution in the installed Playwright if present, otherwise CDP `Accessibility.getFullAXTree` per frame with `DOM.resolveNode` and `DOM.getBoxModel`.
  * Accept, failure. Any one fails the spike. **F1** the input has no accessibility node. **F2** its ref resolves to nothing that fills inside `content`. **F3** the label text is missing or has no box. **F4** geometry binds the wrong label, or both inputs claim it, which passes smoke tests and fills the wrong field. **F5** the `<td onclick>` has no node carrying text and a box.
  * Accept, on failure. Stop, record which failure fired with raw output in `PROGRESS.md`, and raise it as a design decision. Do not patch around it.
  * Plan B, for decision rather than execution. DOM primary perception with accessibility enrichment and labels from table structure. Supersedes ADR 0012 and weakens the "no clean DOM" answer in `REPORT.md`. S1-T08 roughly doubles to two days, and F4 adds half a day to S1-T01. About two days if decided here, three to four if found at S1-T08.
  * Accept, on pass. The mechanism and the observed result for F1 to F5 are recorded as an amendment to ADR 0012.

---

## Slice 1. Thread

Ends at gate S1-T10, a four step replay against the live app returning a typed money output.

* [ ] **S1-T01** Surface model types, locator types and the resolution policy, in `src/core`.
  * Accept: `UINode` carries role, name, `derivedLabel`, value, state, `framePath`, `box` and an opaque handle. The action vocabulary lives in core. Strategy kinds exclude `visual`, `matchPolicy` excludes `first`, relations are geometric, and strategy text is a template. Core owns ordering, ambiguity rejection and degradation records, through a driver supplied `match(strategy)` port.
  * Test: unit, the first resolving strategy wins, an ambiguous strategy under `unique` is skipped, all ambiguous yields `LocatorAmbiguous`, and a lower ranked win is recorded as drift.
* [ ] **S1-T02** Capability schema, refinements and loader.
  * Accept: `effect` and `idempotent` per step, per ADR 0014. No `allowedOrigins`, no `allowReauth`, no stability counters. Refinements: unique step IDs, index matches order, output and `outputResolvable` references resolve, templates name declared inputs or earlier outputs, every acting step has a postcondition, no retry on a non idempotent step, and a step level business outcome uses a declared code. The loader refuses an unsupported `schemaVersion`. `redactionApplied` is a marker, not enforcement.
  * Test: unit, a valid fixture parses, one test per refinement, and a future version yields `SchemaIncompatible`.
* [ ] **S1-T03** Templates, input validation and the result contract.
  * Accept: templates resolve `inputs`, earlier `outputs` and allowlisted `env`, with no expression language. Inputs are validated before any surface opens. `ResultBase` carries `inputNames`, `recoveries[]` and `interventions[]`, and failure constructors require `expected` and `observed`.
  * Test: unit, each scope resolves, an unresolved reference fails before acting, each constraint yields `InputValidation`, and each failure class is constructible.
* [ ] **S1-T04** `ConditionMatcher` evaluation and the money parser.
  * Accept: one matcher language including `all`, `any`, `not` and `outputResolvable`, used by checkpoints and detectors alike. Money is minor units plus currency plus raw text, and the raw text is `pii`.
  * Test: unit, one per matcher kind positive and negative, then `$4,250.75`, `4250.75 USD`, `(125.00)` and `$0.00`, and an unparseable string as a typed failure.
* [ ] **S1-T05** `PolicyEngine.authorize`.
  * Accept: an allowlist of origins, paths and action kinds, a three valued verdict, denied beats allowed, unknown means deny. Confirmation reads the declared `effect` until the profile cross check at S3-T04. One shot approval grants are bound to run, step and target and accepted once.
  * Test: unit, the origin and path table from `docs/SAFETY.md` section 6, an unknown action denied, and a grant accepted once and refused the second time.
* [ ] **S1-T06** MERIDIAN Core, grown from the spike page. Frameset, login with a session cookie, member search, member detail, and `/__control__` reset under `TARGET_TEST_MODE`.
  * Accept: nested tables, no test IDs, generated IDs seeded per process, the two hostile controls kept, three balance formats across seed members. `npm run target` lands here.
  * Test: integration, routes return 200, unauthenticated requests redirect, a known ID returns a row, `00000` returns the no records banner, and control routes are unmounted without the flag.
* [ ] **S1-T07** `SurfaceDriver` interface, `ControlToken` and `FakeSurfaceDriver`.
  * Accept: `act()` requires a current token and throws `ControlLostError` otherwise. The fake exists so the executor, the loop and the control plane are unit testable without Chromium.
  * Test: unit, a stale token is rejected and the fake returns scripted observations.
* [ ] **S1-T08** `WebSurfaceDriver`.
  * Accept: the accessibility tree with geometry and derived labels through the S0-T03 mechanism, frame traversal, refs in document order, and `match(strategy)` for the core resolver.
  * Test: integration, the member ID input resolves through `anchor-relative` despite having no accessible name, with the correct frame path.
* [ ] **S1-T09** `SessionBroker` and `GuardedSurface`.
  * Accept: the broker logs in before leasing a session, so no artifact holds a credential, and a `context.route` handler refuses non allowlisted origins and paths. `authorize` has exactly one call site, inside `GuardedSurface`.
  * Test: integration, a leased session is authenticated and a denied path is refused at the network layer. Unit, a denied action never reaches the driver, and an import graph test proves `replay` and `discovery` cannot reach the raw driver.
* [ ] **S1-T10** Fixture artifact and `ReplayExecutor`. **Gate, Skeleton 1.**
  * Accept: the hand authored `member.readSavingsBalance` has `entryPath` `/servicing` and a `framePath` on every navigate. The executor resolves, authorizes, acts, waits on a bounded condition named in its timeout message, evaluates checkpoints into `CheckpointFailed`, and extracts typed outputs or `OutputUnresolvable`. `test:integration` lands here.
  * Accept, re-forecast. Measured hours for Slices 0 and 1 go into `PROGRESS.md` and every remaining slice is re-forecast from them.
  * Test: unit against the fake for the happy path. Integration, member `10001` returns `success` with 425075 minor units in USD.

---

## Slice 2. Perception spike

* [ ] **S2-T01** Live model spike. **Gate, Perception.**
  * Accept: a crude loop in `scratch/`, real model, the S1-T06 app, refs only tools, no policy, recorder or artifact. The question is whether a real model reaches the savings balance for `10001` in under twenty steps from the S1-T08 observation format. Findings go into `PROGRESS.md`. A needed change to the observation format is an amendment to ADR 0012 and is folded into this task, not deferred.

---

## Slice 3. Harden

Everything after this slice persists something, so redaction and the scanner exist first.

* [ ] **S3-T01** `SurfaceDriver` contract suite, run against the fake and the web driver.
  * Accept: one reusable suite parameterised over driver factories. It is the evidence behind the seam claim in `REPORT.md`, not tooling.
  * Test: both drivers pass stale token rejection, `not_found` and `ambiguous` resolution, frame path scoping, a derived label on an unnamed node, and a bounded `waitFor` timeout that names its condition.
* [ ] **S3-T02** `Redactor` and sensitivity propagation.
  * Accept: provenance based and pattern based, patterns loaded with an explicit `flags` field, Luhn validated card numbers, idempotent, nested objects traversed. An output fed by a secret input inherits secret.
  * Test: unit, every pattern positive and negative, Luhn rejects an invalid number, redacting twice equals once, and propagation lifts sensitivity.
* [ ] **S3-T03** Structured logger and `EvidenceSink`.
  * Accept: JSON lines carrying `runId`, redacted at the sink. The sink writes logs, screenshots, accessibility snapshots and a manifest to `evidence/<phase>/<runId>/`, masks screenshots with Playwright's own mask option, and names a caller projection with real values and a redacted persisted projection.
  * Test: unit, log lines are valid JSON and redacted, and the manifest lists every file. Integration, a masked region is absent from the stored image, sampled by pixel.
* [ ] **S3-T04** App profile, `profiles/meridian-core.json`.
  * Accept: the route plus method table that classifies `effect` and `idempotent`, the field sensitivity map that masks member names and balances, and the generic detectors. An unclassified route is write and not idempotent. The policy engine now cross checks declared effect against the profile.
  * Test: unit, an unknown route classifies as write, a capability whose declared effect contradicts the profile is refused, and the member name cell is `pii`.
* [ ] **S3-T05** Evidence scanner with canaries. Lifts the pre Harden rule.
  * Accept: scans `evidence/`, `capabilities/` and `tests/fixtures/cassettes/` for seeded canaries, meaning the seed member names, balances, IDs and a planted Luhn valid number, as well as the redaction patterns. Removes the three `.gitignore` exclusions in the same commit that turns the scanner on.
  * Test: unit, fails on a planted canary and passes on the committed tree.

---

## Slice 4. Discovery

Ends at gate S4-T10. Goal, live discovery, reviewed artifact, and a replay that returns a business outcome.

* [ ] **S4-T01** Outcome classifier and the classification race.
  * Accept: one total precedence order. Step detectors, then capability outcomes, then app profile, and within a tie business outcome beats failure. The profile never declares a business outcome. After acting, the executor waits on any of the postcondition, the outcome detectors and the profile detectors, and classifies whichever fired. An unclassifiable state is `Internal`.
  * Test: unit, the precedence table. Integration, `00000` classifies `MEMBER_NOT_FOUND` well inside the step timeout.
* [ ] **S4-T02** `ModelClient`, `FakeModelClient` and `CassetteModelClient`.
  * Accept: cassette matching is positional with a tool set and observation hash assertion, per ADR 0017.
  * Test: unit, deterministic replay, and a changed observation hash fails with a diff.
* [ ] **S4-T03** Observation builder, prompt and tool schema.
  * Accept: prune to interactive and text bearing nodes, refs in document order, derived labels, redaction through the profile before the prompt. Tools are refs only, `click`, `fill` with an input name, `select`, `press`, `navigate`, `extract`, `escalate` and `done`, and never `waitFor` or `assert`, per ADR 0013. The goal is templated so it never carries a member ID.
  * Test: unit, a fixture observation contains no unredacted PII, and tool definitions are asserted against the allowed subset.
* [ ] **S4-T04** `AgentLoop`.
  * Accept: observe, decide, authorize, act, record. Stops on `done`, max steps and max duration, and budget exhaustion is a failure, not an escalation. `ModelRequested` is the discovery stuck detector.
  * Test: unit with the fake model, each stopping condition, a denied action never reaches the driver, a bad ref yields a corrective observation, and an `escalate` call raises an intervention.
* [ ] **S4-T05** Locator derivation, record time verification and the `Recorder`.
  * Accept: bundles are derived from the real element at action time, never from model output. Each strategy is resolved at record time and dropped unless it uniquely hits the element. Text equal to a declared input value becomes a template.
  * Test: unit, an unnamed input yields `anchor-relative` from its derived label, an ambiguous `text` strategy is dropped, a member ID never lands as a literal, and model text is never used as a selector.
* [ ] **S4-T06** `RunTrace` and the `Generalizer`, four transforms.
  * Accept: the trace stores observation hashes, decisions, authorization verdicts and each acted element's redacted neighbourhood. The generalizer prunes failed and no op actions, parameterises input values, infers a checkpoint per step from the observation that followed it, and types outputs from `extract` calls. Discovery success is non circular. The success condition is synthesized from the final observation and re asserted against it.
  * Test: unit, one per transform, a fixture trace compared against an expected artifact, a sensitive literal never emitted, and a success condition that does not hold fails the run.
* [ ] **S4-T07** `CapabilityStore` writer, `npm run discover` and `npm run replay`.
  * Accept: canonical JSON with stable key order, and a refusal scan for declared input values and redactor matches before writing. Discovery returns a typed `DiscoveryResult`. Replay takes inputs from stdin or a file, never argv. `test:e2e` lands here.
  * Test: unit, a byte stable round trip and a refused sensitive literal. E2E, the replay CLI exits 0 on success and non zero on failure, with valid JSON output.
* [ ] **S4-T08** The live discovery run. Commit its evidence.
  * Accept: a real key against the S1-T06 app. `evidence/discovery/<runId>/` holds the redacted transcript, the trace, screenshots and the artifact at `1.0.0`, status draft. This is the brief's one non negotiable requirement.
* [ ] **S4-T09** Negative probe review and approval, `npm run review`.
  * Accept: replays the draft with `00000`, stops where the postcondition fails, and lets a reviewer name `MEMBER_NOT_FOUND` while the recorder derives the detector from the real banner. Emits `1.1.0` with `provenance: 'manual'`, a minor bump by rule. The same command approves, writing `status`, `approvedBy` and `approvedAt`.
  * Test: integration, the probe produces a detector that resolves on the banner.
* [ ] **S4-T10** Cassette E2E and the reviewed replays. **Gate, Skeleton 2.**
  * Accept: the cassette recorded from S4-T08 drives the full thread offline. `evidence/replay/success/` for `10001` and `evidence/replay/businessOutcome/` for `00000` returning `business_outcome`, both from the discovered `1.1.0` and not the S1-T10 fixture.
  * Test: e2e, the thread runs with no network and no key.

---

## Slice 5. Escalation

Ends at gate S5-T07, where a human takes the live session, acts, hands back, and the run completes. It also carries the write flow, which is all of requirement 3.4.

* [ ] **S5-T01** Control reducer, `InterventionRequest`, in memory store, and the detectors.
  * Accept: the seven state reducer around the S1-T07 token, rotating on every transition. An intervention carries the capability or goal, the step, a screenshot, the reason and a plain language explanation, redacted, with no resume token and no journal. Three detectors in total. `ModelRequested` from S4-T04 for discovery, `PolicyConfirmation` for write steps, and `UnclassifiedCondition` for anything no detector claims. Each kept detector backs a required demonstration. `NoProgress`, `ActionFailureStreak` and `RecoveryExhausted` are cut, because a step or duration budget already ends those runs as typed failures.
  * Test: unit, every legal and illegal transition, a token held across a transition rejected, the payload complete with no unredacted PII, and each detector firing on its condition and silent otherwise.
* [ ] **S5-T02** Operator API and page, hosted by the run.
  * Accept: the run blocks in `pending_human` and prints the intervention URL. Endpoints to list, read, claim, release and abort, and a masked screenshot endpoint the page polls. A claim timeout ends the run as `escalated` with `unclaimed`. The page is bare HTML with a canvas and three buttons.
  * Test: integration, a claim transfers control, a release returns it, an unclaimed intervention times out, and screenshots are masked.
* [ ] **S5-T03** CDP input forwarding with hit testing, and human action records.
  * Accept: `POST /sessions/:id/input` requires the current human token. Before dispatching a click it hit tests with `DOM.getNodeForLocation` and runs the recorder, so each human action carries a derived bundle. Typed values are never captured. Records go to evidence only.
  * Test: integration, a forwarded click changes state in the same session, a stale token is refused, and the record carries a resolvable bundle and no value.
* [ ] **S5-T04** Resume revalidation and the one shot confirm grant.
  * Accept: on release the executor re observes and checks, in order, capability success, a declared outcome, the step postcondition, an approval grant, and the step precondition, and otherwise escalates again. A grant is bound to run, step and target and consumed once.
  * Test: unit, one per branch, including a human who finished the task reporting success without re acting, and a grant refused on reuse.
* [ ] **S5-T05** Fault arming, `surpriseDialog`, and `UnexpectedDialog` escalation.
  * Accept: `POST /__control__/fault` arms a route scoped fault with a count. `surpriseDialog` renders an HTML modal. A native dialog handler is registered that neither accepts nor dismisses. An unexpected dialog is escalated and never clicked.
  * Test: integration, no click dispatched, a screenshot captured, and an intervention raised.
* [ ] **S5-T06** Sub account write flow, `flaky503`, and `member.openSubAccount`.
  * Accept: the form, field validation and confirmation screen in the app. The capability confirms during a draft replay and runs unattended once approved with `allowUnattendedReplay`. The submit is not idempotent, so a 503 on it is never retried and the postcondition is re evaluated instead. A field validation error is a declared business outcome carrying its message as structured data.
  * Test: integration, confirm then proceed, approved and unattended, no second post under `flaky503` on the submit, and validation returned as `business_outcome`.
* [ ] **S5-T07** Full handoff cycle and committed evidence. **Gate, Skeleton 3.**
  * Accept: `MockOperator` drives the real API headlessly. `evidence/replay/escalated/` shows escalate, claim, a forwarded click on the live session, release, resume, and a result carrying the episode in `interventions[]`.
  * Test: integration, the headless cycle completes and the run finishes.

---

## Slice 6. Error breadth

* [ ] **S6-T01** Remaining faults, `denied`, `relabel`, `duplicateIds` and `hang`.
  * Accept: route scoped and deterministic, armed with a count.
  * Test: integration, one per fault asserting its documented behaviour.
* [ ] **S6-T02** Retry on idempotent steps, `TransientLoad` recovery, and replay budgets.
  * Accept: bounded exponential backoff through `Clock.delay`, gated on `idempotent`. `TransientLoad` retries a 502 or 503 up to three attempts and is recorded in `recoveries`, including on success. Budget exhaustion is a `Timeout` failure.
  * Test: unit with fake timers, backoff timing, a non idempotent step never retried, and a budget ending the run.
* [ ] **S6-T03** Result assembly and the replay import graph test.
  * Accept: `ReplayResult` always carries `recoveries`, `interventions` and `drift`, including on success. `src/replay` imports no model client.
  * Test: unit, a run with retries reports them on a successful result, and the import graph walk finds no model client.
* [ ] **S6-T04** The result matrix.
  * Accept: one integration test per row of `docs/ERROR_TAXONOMY.md` section 8, reconciled to the kept fault set. `relabel` carries drift and is reported as a success with a drift record.
  * Test: integration, each row asserts its exact status and code.

---

## Slice 7. Seams

* [ ] **S7-T01** `DesktopSurfaceDriver` stub.
  * Accept: implements the interface, throws `NotImplementedError` per verb, and documents the verb to UI Automation mapping, including geometric relations over bounding rectangles.
  * Test: unit, the class satisfies the interface type and every verb throws a named error.
* [ ] **S7-T02** JSON Schema generation and the review sheet.
  * Accept: generated from the Zod schema, so a calling agent reads the same contract the executor enforces. A human readable sheet lists intents, inputs, outputs and declared outcomes.
  * Test: unit, the tool schema names every required input with its type, and the sheet lists every declared outcome.

---

## Slice 8. Deliverables, reserved

Three days, never spent building. Runs wherever building stopped.

* [ ] **S8-T01** `README.md`.
  * Accept: setup, config, the exact demo sequence of discover, review and replay, how to run offline from the cassette, the hosts entries or `Host` header the target app needs, and a statement that `apps/target` is a fixture and the Express and Fastify split is deliberate.
* [ ] **S8-T02** `REPORT.md`.
  * Accept: one to three pages, first person, the brief's seven headings in their exact wording including the ampersands and the hyphen. The Cuts section starts from the cut list below.
* [ ] **S8-T03** Pre submission checks.
  * Accept: a walk of `docs/REQUIREMENTS.md` row by row. One grep for task IDs this plan does not define, with `retired` exempt. One grep for raw `setTimeout`, `setInterval` and `setImmediate` in `src/core`, `src/replay`, `src/discovery` and `src/control`. A pass for dead code, skipped tests, TODO comments and secrets. `evidence/README.md` naming the one file worth opening in each directory.
* [ ] **S8-T04** Fresh clone verification.
  * Accept: clone to a new directory, install, run the full suite, and run the demo path from the README exactly as written.

---

## Time pressure protocol

**Never cut.** The live discovery run, S4-T08. The business outcome split, S4-T01 with the `00000` replay in S4-T10. A real control transfer on the same session, S5-T03. The write flow, S5-T06. The artifact schema, S1-T02. `REPORT.md`, S8-T02. Redaction, the policy choke point, and the canary scanner.

**Cut next, in this order, if the S1-T10 re-forecast demands it.**

1. Slice 6 down to the `denied` and `duplicateIds` rows, because the business outcome and escalation rows already exist from Slices 4 and 5.
2. The cassette E2E in S4-T10, with `REPORT.md` stating that offline running is unsupported.
3. S7-T02, with `REPORT.md` stating that the Zod schema is the contract and nothing generates a tool definition from it.
4. The contract suite S3-T01, leaving the desktop stub as the only seam evidence.

Anything cut is added to the cut list below with its reason, in the same commit.

---

## Cut list

Written as it will read in the Cuts section of `REPORT.md`. First person, what is not demonstrated, why, and what I would build next.

* **Cross tenant reuse, requirement 3.7b.** I designed a capability as a base artifact plus sparse overlays that may override locators and output bindings but never the contract, each tied to a range of base versions. I did not build a second tenant, the overlay merge, or a replay of one tenant's artifact against another. The brief allows 3.7 to be designed rather than built, and the overlay schema is in `docs/ARTIFACT_SCHEMA.md`. Next, a second variant of the target app and a replay that fails with `LocatorNotFound` until an overlay is applied.
* **Drift management across tenants, requirement 3.7c.** Replay records a degradation whenever a lower ranked locator strategy wins, and the `relabel` fault demonstrates it. I did not build the per checkpoint surface fingerprint or the per variant review flag that would turn those records into a managed signal. Next, both, since detection already exists and management is the missing half.
* **Session expiry.** The target app has no expiring session, the executor has no re authentication path, and the policy field that would permit one is gone. A capability whose session lapses mid run fails rather than recovering. Next, re authentication that restarts from the first step only when every completed step was a read, because resuming a half finished write after a re login risks a double post.
* **Recovery breadth, requirement 3.3f.** The one recovery implemented is `TransientLoad`, which retries a 502 or 503 on idempotent steps and records it even when the run succeeds. Known interstitials and stale element handles are not handled, and their faults were removed from the target app. Every result already carries `recoveries[]`, so adding a handler does not change the contract. Next, the known interstitial handler, the most common real cause of breakage between tenants on one product.
* **Fault coverage.** The target app injects six faults, `flaky503`, `denied`, `surpriseDialog`, `relabel`, `duplicateIds` and `hang`. There is no application error page and no slow load. Validation is still shown, as a declared business outcome of the write flow rather than an injected fault. `SurfaceUnavailable` is a defined failure class with no end to end test. Next, the error page fault, because it closes the only failure class without a test.
* **Live operator view.** The operator page polls masked screenshots rather than streaming them. It is enough to unblock a flow and poor for anything time sensitive. The control transfer itself is real, on the same session with the same cookies, with forwarded input that is hit tested and recorded. Next, streaming.
* **Learning from the operator.** Each human action during a handoff is recorded in evidence with a locator derived from the element clicked. It is not turned into a draft step on a new revision, so a person unblocking a run does not yet improve the capability. Next, draft steps marked as human provenance that need approval before they run unattended.
* **Stuck detection, requirement 3.6a.** Three detectors raise an intervention. The model asking for help, a write step needing confirmation, and a condition nothing classifies. Detecting a model that makes no progress, a streak of failed actions, or an exhausted recovery is not built. Those runs end as typed failures at their step or duration budget, so they reach an engineer rather than an operator. Next, no progress detection on the accessibility hash.
* **Generalization depth.** The generalizer prunes failed actions, parameterises inputs, infers a checkpoint per step and types outputs. It does not turn concrete routes into patterns, and it does not infer separate waits, because every wait is the step postcondition raced against the outcome detectors. Next, route canonicalisation, which is the hook cross tenant reuse needs.
* **Version change classification.** Artifacts carry a schema version the engine refuses to exceed, and a capability version. Nothing classifies a change as patch, minor or major. The review step bumps the minor version by rule, because adding a declared outcome is minor by definition. Next, the classifier, once overlays exist to depend on it.
* **Capability catalog.** There is no endpoint listing approved capabilities as callable tools and no demonstration of a model invoking one. The JSON Schema such a catalog would serve is generated. Next, the catalog, the one stretch goal I would pick.
* **Rate limiting and CI.** The allowlist declares an action rate that nothing enforces, and there is no CI pipeline. A green local suite is the verification path and the README gives the command. Next, a throttle through the injected clock, and CI running the same scripts.
* **Automated suite guards.** Coverage thresholds, a lint rule against raw timers and a test that fails when a socket leaves loopback were planned and cut, as tooling about the suite rather than the system. The raw timer rule is checked once by grep before submission. Next, restore them alongside CI.
* **Desktop surface and visual targeting.** The desktop driver is a stub that throws per verb and documents its mapping to UI Automation, which was always the plan. There is no screenshot and coordinate locator strategy, because nothing in the system would have executed one. Next, a visual fallback that escalates rather than clicking, for canvas surfaces.

---

## Open items

* **The timebox.** Ten days is below the floor. About twenty days for the uncuttable set, or twenty seven for this plan. Decided by you, and replaced by measured numbers at S1-T10.
* **Whether `member.openSubAccount` is hand authored or discovered by a second live run.** Decided at S5-T06.
