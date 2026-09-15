# Implementation plan and master checklist

The single source of truth for what is left to build. Tick a box when its acceptance criteria are met and `npm run test` plus `npm run typecheck` are green. `PROGRESS.md` updates once per slice.

## Rules

* **Task IDs.** Forty six tasks, and this consolidation was the last renumbering. From here a moved task keeps its ID and a removed one stays in place, struck through. An ID written as `retired S0-T08` is deliberate history. One grep at S8-T03 checks references before submission.
* **Nothing is committed before Harden.** Nothing produced by running code or a model is committed until Slice 3 closes. That covers spike output, transcripts, screenshots, generated artifacts, cassettes and `evidence/`. Hand written source, tests, fixtures and synthetic seed data are inputs and are committed as they land. `.gitignore` enforces the rule, and S3-T05 lifts the exclusions in the same commit that turns on the scanner. `scratch/` stays ignored.
* **The tail is reserved.** Slice 8 is never spent building. Wherever building stops, Slice 8 runs.
* **Uncuttable.** The live discovery run, the business outcome split, a real control transfer on the same session, the artifact schema, the sub account write flow, and `REPORT.md`.

## Order

Uncuttable work lands first, so a stop removes breadth rather than a requirement. Thread, then the perception spike, then Harden because Discovery commits evidence, then Discovery, then Escalation with the write flow, then error breadth, then the seams, then the reserved tail.

| Slice | Tasks | Gate |
| --- | --- | --- |
| S0 Foundation | 3 | |
| S1 Thread | 10 | Skeleton 1 at S1-T10 |
| S2 Perception spike | 1 | Perception at S2-T01 |
| S3 Harden | 5 | |
| S4 Discovery | 10 | Skeleton 2 at S4-T10 |
| S5 Escalation | 7 | Skeleton 3 at S5-T07 |
| S6 Error breadth | 4 | |
| S7 Seams | 2 | |
| S8 Deliverables, reserved | 4 | |

---

## Slice 0. Foundation

* [x] **S0-T01** Repo skeleton, `package.json`, TypeScript strict, ESM, Node 22, Vitest.
  * Accept: `npm run typecheck` passes on an empty `src` and `npm run test` passes with no tests. The tree matches `CLAUDE.md` section 4 except the output directories the pre Harden rule keeps out of git. Each script lands with the task that makes it work.
* [x] **S0-T02** `Clock`, `IdProvider` and Zod validated env config.
  * Accept: one `Clock` with `now()` and `delay(ms)`, the only sanctioned delay. No secret has a default. `ANTHROPIC_MODEL` lives in config, per ADR 0011.
  * Test: unit, seeded providers are deterministic, and a missing required variable fails with a named message.
* [x] **S0-T03** Perception viability spike, half a day. Answers whether ADR 0012 survives the surface built to defeat it.
  * Accept, the page. A frameset with `nav`, `content` and `status` frames. In `content`, a nested table form with an input labelled only by a sibling `<td>` reading `Member  ID:`, a second labelled input one row below, and a `<td onclick>` submit with inner text only. It is written as the first file of `apps/target`, not as throwaway, and S1-T06 grows the target app from it. The spike script and its output stay in `scratch/`.
  * Accept, the mechanism. Aria-ref resolution in the installed Playwright if present, otherwise CDP `Accessibility.getFullAXTree` per frame with `DOM.resolveNode` and `DOM.getBoxModel`.
  * Accept, failure. Any one fails the spike. **F1** the input has no accessibility node. **F2** its ref resolves to nothing that fills inside `content`. **F3** the label text is missing or has no box. **F4** geometry binds the wrong label, or both inputs claim it, which passes smoke tests and fills the wrong field. **F5** the `<td onclick>` has no node carrying text and a box.
  * Accept, on failure. Stop, record which failure fired with raw output in `PROGRESS.md`, and raise it as a design decision. Do not patch around it.
  * Plan B, for decision rather than execution. DOM primary perception with accessibility enrichment and labels from table structure. It supersedes ADR 0012 and weakens the "no clean DOM" answer in `REPORT.md`. S1-T08 roughly doubles and F4 widens S1-T01. The rework is several times larger if the failure is found at S1-T08 rather than here, which is why this spike runs first.
  * Accept, on pass. The mechanism and the observed result for F1 to F5 are recorded as an amendment to ADR 0012.

---

## Slice 1. Thread

Ends at gate S1-T10, a four step replay against the live app returning a typed money output.

* [x] **S1-T01** Surface model types, locator types and the resolution policy, in `src/core`.
  * Accept: `UINode` carries ref, role, name, `derivedLabel`, value, state, `framePath`, `box` and a clickable hint, and no raw handle, because the driver resolves a ref to its live element. The action vocabulary lives in core. Strategy kinds exclude `visual`, `matchPolicy` excludes `first`, relations are geometric, and strategy text is a template. Core owns ordering, ambiguity rejection and degradation records, through a driver supplied `match(strategy)` port.
  * Test: unit, the first resolving strategy wins, an ambiguous strategy under `unique` is skipped, all ambiguous yields `LocatorAmbiguous`, nothing resolving yields `LocatorNotFound` with every attempt listed, and a lower ranked win is recorded as drift.
* [x] **S1-T02** Capability schema, refinements and loader.
  * Accept: `effect` and `idempotent` per step, per ADR 0014. No `allowedOrigins`, no `allowReauth`, no `baseUrl`, no `variant`, no `optional` step flag, no `surfaceFingerprint` and no stability counters. Step provenance is `model` or `manual`. A navigate carries a templated `path` and a `framePath`. Refinements: unique step IDs, index matches order, output and `outputResolvable` references resolve, templates name declared inputs or earlier outputs, every acting step has a postcondition, no retry on a non idempotent step, and a step level business outcome uses a declared code. The loader refuses an unsupported `schemaVersion`. `redactionApplied` is a marker, not enforcement.
  * Test: unit, a valid fixture parses, one test per refinement, and a future version yields `SchemaIncompatible`.
* [x] **S1-T03** Templates, input validation and the result contract.
  * Accept: templates resolve `inputs`, earlier `outputs` and allowlisted `env`, with no expression language. Inputs are validated before any surface opens. `ResultBase` carries `inputNames`, `recoveries[]`, `interventions[]` and `drift[]`, and failure constructors require `expected` and `observed`.
  * Test: unit, each scope resolves, an unresolved reference fails before acting, each constraint yields `InputValidation`, and each failure class is constructible.
* [x] **S1-T04** `ConditionMatcher` evaluation and the money parser.
  * Accept: one matcher language including `all`, `any`, `not` and `outputResolvable`, used by checkpoints and detectors alike. Money is minor units plus currency plus raw text, and the raw text is `pii`.
  * Test: unit, one per matcher kind positive and negative, then `$4,250.75`, `4250.75 USD`, `(125.00)` and `$0.00`, and an unparseable string as a typed failure.
* [x] **S1-T05** `PolicyEngine.authorize`.
  * Accept: an allowlist of origins, paths and action kinds, a three valued verdict, denied beats allowed, unknown means deny. Confirmation reads the declared `effect` until the profile cross check at S3-T04. One shot approval grants are bound to run, step and target and accepted once.
  * Test: unit, the origin and path table from `docs/SAFETY.md` section 6, an unknown action denied, and a grant accepted once and refused the second time.
* [x] **S1-T06** MERIDIAN Core, grown from the spike page. Frameset, login with a session cookie, member search, member detail, and `/__control__` reset under `TARGET_TEST_MODE`.
  * Accept: nested tables, no test IDs, generated IDs seeded per process, the two hostile controls kept, and the seed members from `docs/TARGET_APP.md` section 6 with their four balance formats and the canary card number. `npm run target` lands here.
  * Test: integration, routes return 200, unauthenticated requests redirect, a known ID returns a row, `00000` returns the no records banner, and control routes are unmounted without the flag.
* [x] **S1-T07** `SurfaceDriver` interface, `ControlToken` and `FakeSurfaceDriver`.
  * Accept: `act()` requires a current token and throws `ControlLostError` otherwise. The fake exists so the executor, the loop and the control plane are unit testable without Chromium.
  * Test: unit, a stale token is rejected and the fake returns scripted observations.
* [x] **S1-T08** `WebSurfaceDriver`.
  * Accept: the accessibility tree with geometry and derived labels through the S0-T03 mechanism, frame traversal, refs in document order, and `match(strategy)` for the core resolver.
  * Test: integration, the member ID input resolves through `anchor-relative` despite having no accessible name, with the correct frame path.
* [x] **S1-T09** `SessionBroker` and `GuardedSurface`.
  * Accept: the broker logs in before leasing a session, so no artifact holds a credential, and a `context.route` handler refuses non allowlisted origins and paths. `authorize` has exactly one call site, inside `GuardedSurface`.
  * Test: integration, a leased session is authenticated and a denied path is refused at the network layer. Unit, a denied action never reaches the driver, and an import graph test proves `replay` and `discovery` cannot reach the raw driver.
* [x] **S1-T10** Fixture artifact and `ReplayExecutor`. **Gate, Skeleton 1.**
  * Accept: the hand authored `member.readSavingsBalance` has `entryPath` `/servicing` and a `framePath` on every navigate. The executor resolves, authorizes, acts, waits on a bounded condition named in its timeout message, evaluates checkpoints into `CheckpointFailed`, and extracts typed outputs or `OutputUnresolvable`. `test:integration` lands here.
  * Test: unit against the fake for the happy path. Integration, member `10001` returns `success` with 425075 minor units in USD.

---

## Slice 2. Perception spike

* [x] **S2-T01** Live model spike. **Gate, Perception.**
  * Accept: a crude loop in `scratch/`, real model, the S1-T06 app, refs only tools, no policy, recorder or artifact. The question is whether a real model reaches the savings balance for `10001` in under twenty steps from the S1-T08 observation format. Findings go into `PROGRESS.md`. A needed change to the observation format is an amendment to ADR 0012 and is folded into this task, not deferred.

---

## Slice 3. Harden

Everything after this slice persists something, so redaction and the scanner exist first.

* [x] **S3-T01** `SurfaceDriver` contract suite, run against the fake and the web driver.
  * Accept: one reusable suite parameterised over driver factories. It is the evidence behind the seam claim in `REPORT.md`, not tooling.
  * Test: both drivers pass stale token rejection, `not_found` and `ambiguous` resolution, frame path scoping, a derived label on an unnamed node, a geometric relation, and `waitForChange` reporting a change after an action and a bounded timeout when nothing changes. The timeout message that names its condition belongs to the race and is proven by the executor tests.
* [x] **S3-T02** `Redactor` and sensitivity propagation.
  * Accept: provenance based and pattern based, patterns loaded with an explicit `flags` field, Luhn validated card numbers, idempotent, nested objects traversed. An output fed by a secret input inherits secret.
  * Test: unit, every pattern positive and negative, Luhn rejects an invalid number, redacting twice equals once, and propagation lifts sensitivity.
* [x] **S3-T03** Structured logger and `EvidenceSink`.
  * Accept: JSON lines carrying `runId`, redacted at the sink. The sink writes logs, screenshots, accessibility snapshots and a manifest to `evidence/<phase>/<runId>/`, masks screenshots with Playwright's own mask option, and names a caller projection with real values and a redacted persisted projection.
  * Test: unit, log lines are valid JSON and redacted, and the manifest lists every file. Integration, a masked region is absent from the stored image, sampled by pixel.
* [ ] **S3-T04** App profile, `profiles/meridian-core.json`.
  * Accept: the route plus method table that classifies `effect` and `idempotent`, the field sensitivity map that masks member names and balances, and the generic detectors, meaning the login redirect classified as `SessionExpired` and the generic error banner. An unclassified route is write and not idempotent. The policy engine now cross checks declared effect against the profile.
  * Test: unit, an unknown route classifies as write, a capability whose declared effect contradicts the profile is refused, the login redirect classifies as `SessionExpired`, and the member name cell is `pii`.
* [ ] **S3-T05** Evidence scanner with canaries. Lifts the pre Harden rule.
  * Accept: scans `evidence/`, `capabilities/` and `tests/fixtures/cassettes/` for the seeded canaries from `docs/TARGET_APP.md` section 6, as well as the redaction patterns. Removes the three `.gitignore` exclusions in the same commit that turns the scanner on.
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
* [ ] **S4-T04** `AgentLoop`, with `NoProgress` and `ModelRequested`.
  * Accept: observe, decide, authorize, act, record. Stops on `done`, max steps and max duration, and budget exhaustion is a `Timeout` failure, not an escalation. `NoProgress` fires when the observation hash is unchanged across three consecutive acting tool calls, and only `click`, `fill`, `select`, `press` and `navigate` count. The hash excludes static text. `ModelRequested` fires when the model calls `escalate`. Both end the run as `escalated` in its `DiscoveryResult` until S5-T01 raises them as live interventions.
  * Test: unit with the fake model, each stopping condition, `NoProgress` firing after three unchanged hashes and staying silent when only static text changed, an `escalate` call raising `ModelRequested`, a denied action never reaching the driver, and a bad ref yielding a corrective observation.
* [ ] **S4-T05** Locator derivation, record time verification and the `Recorder`.
  * Accept: bundles are derived from the real element at action time, never from model output. Each strategy is resolved at record time and dropped unless it uniquely hits the element. Text equal to a declared input value becomes a template.
  * Test: unit, an unnamed input yields `anchor-relative` from its derived label, an ambiguous `text` strategy is dropped, a member ID never lands as a literal, and model text is never used as a selector.
* [ ] **S4-T06** `RunTrace` and the `Generalizer`, five transforms.
  * Accept: the trace stores observation hashes, decisions, authorization verdicts and each acted element's redacted neighbourhood. The generalizer prunes failed and no op actions, parameterises input values in step values and locator text, canonicalises input values inside navigate paths and URL patterns, infers a checkpoint per step from the observation that followed it, and types outputs from `extract` calls. Canonicalisation is a correctness rule, because a navigate path that kept `/member/10001` would replay the wrong member for any other input. Discovery success is non circular. The success condition is synthesized from the final observation and re asserted against it.
  * Test: unit, one per transform, a recorded navigate to a member path stored as a template, a fixture trace compared against an expected artifact, a sensitive literal never emitted, and a success condition that does not hold failing the run.
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

* [ ] **S5-T01** Control reducer, `InterventionRequest`, in memory store, and `UnclassifiedCondition`.
  * Accept: the seven state reducer around the S1-T07 token, rotating on every transition. An intervention carries the capability or goal, the step, a screenshot, the reason and a plain language explanation, redacted, with no resume token and no journal. Stuck detection is three detectors. `NoProgress` and `ModelRequested` from S4-T04 now raise live interventions, and `UnclassifiedCondition` fires in either phase on a dialog no rule claims. A policy `confirm` is not a stuck detector. It uses the same channel for a healthy run that needs approval. `ActionFailureStreak` and `RecoveryExhausted` are cut, because a step or duration budget already ends those runs as typed failures that belong to an engineer.
  * Test: unit, every legal and illegal transition, a token held across a transition rejected, the payload complete with no unredacted PII, `UnclassifiedCondition` firing on an unclaimed dialog and silent when a rule claims it, and a discovery `NoProgress` signal raised as an intervention.
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
  * Accept: the form, field validation and confirmation screen in the app. The capability confirms during a draft replay and runs unattended once approved with `allowUnattendedReplay`. The submit is not idempotent, so a 503 on it is never retried and the run ends as `SurfaceUnavailable` marked retryable, with exactly one submission recorded by the app. An invalid opening amount returns a field error, declared as a business outcome carrying its message as structured data.
  * Test: integration, confirm then proceed, approved and unattended, exactly one submission under `flaky503` on the submit, and an invalid amount returned as `business_outcome`.
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
  * Accept: one integration test per row of `docs/ERROR_TAXONOMY.md` section 8. `relabel` carries drift and is reported as a success with a drift record.
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

Never spent building. Runs wherever building stopped.

* [ ] **S8-T01** `README.md`.
  * Accept: setup, config with every key in `.env.example` and the value to use, including the current default model, the exact demo sequence of discover, review and replay, how to run offline from the cassette, that the target app runs on `http://localhost:4010` with no hosts file changes, and a statement that `apps/target` is a fixture and the Express and Fastify split is deliberate.
* [ ] **S8-T02** `REPORT.md`.
  * Accept: one to three pages, first person, the brief's seven headings in their exact wording including the ampersands and the hyphen. Section 3 tells the stale ref finding from S1-T08, where an old ref named the card number cell after navigation, as the evidence for derived and verified locators over model authored selectors, and the S1-T10 wait that passed the gate while broken and was caught by its test. Section 7 starts from the draft under Cuts for REPORT section 7 below, and stays near half a page. The full list in `PROGRESS.md` is source material, not the section.
* [ ] **S8-T03** Pre submission checks.
  * Accept: a walk of `docs/REQUIREMENTS.md` row by row. One grep for task IDs this plan does not define, with `retired` exempt. One grep for raw `setTimeout`, `setInterval` and `setImmediate` in `src/core`, `src/replay`, `src/discovery` and `src/control`. A pass for dead code, skipped tests, TODO comments and secrets. `evidence/README.md` naming the one file worth opening in each directory.
* [ ] **S8-T04** Fresh clone verification.
  * Accept: clone to a new directory, install, run the full suite, and run the demo path from the README exactly as written.

---

## Time pressure protocol

**Never cut.** The live discovery run, S4-T08. The business outcome split, S4-T01 with the `00000` replay in S4-T10. A real control transfer on the same session, S5-T03. The write flow, S5-T06. The artifact schema, S1-T02. `REPORT.md`, S8-T02. Redaction, the policy choke point, and the canary scanner.

**Cut next, in this order, if work has to stop before Slice 7 is done.**

1. Slice 6 down to the `denied` and `duplicateIds` rows, because the business outcome and escalation rows already exist from Slices 4 and 5.
2. The cassette E2E in S4-T10, with `REPORT.md` stating that offline running is unsupported.
3. S7-T02, with `REPORT.md` stating that the Zod schema is the contract and nothing generates a tool definition from it.
4. The contract suite S3-T01, leaving the desktop stub as the only seam evidence.

Anything cut is added to the list in `PROGRESS.md` with its reason, in the same commit.

---

## Cuts for REPORT section 7

The draft for S8-T02, about half a page. It groups the fourteen entries under Deferred and cut in `PROGRESS.md`, which remain the full record.

> I built every core requirement as a thin, real mechanism and cut breadth around them. These are the cuts a reviewer is most likely to notice, most important first.
>
> * **Cross tenant reuse and drift management are designed, not built.** Overlays that rebind locators and outputs but never the contract are specified in `docs/ARTIFACT_SCHEMA.md` and ADR 0015, and replay records locator degradation, but there is no second tenant, no overlay merge and no per tenant drift signal.
> * **Recovery and fault coverage are narrow.** Transient 502 and 503 responses are retried on idempotent steps and reported even on success, but interstitials, stale elements and session expiry are not recovered, and the target app injects six faults.
> * **The operator handoff is real but thin.** Control moves on the live session with hit tested and recorded input, while the operator page polls screenshots, human actions stay in evidence rather than becoming draft steps, and stuck detection covers no progress, unclassified dialogs and the model asking for help.
> * **Capability tooling stops at the contract.** The JSON Schema is generated, but no catalog serves it, nothing classifies version changes, and the generalizer adds no stability wait beyond the postcondition race.
> * **Guardrails around the code are manual.** There is no CI, coverage gate, lint rule or action rate limit, there is no visual locator fallback, and the desktop driver is a documented stub.
>
> The one thing I would build next is a second tenant of the target app, because its differences would force the overlay merge, the interstitial handler and drift management into existence together.

---

## Open items

* **Whether `member.openSubAccount` is hand authored or discovered by a second live run.** Decided at S5-T06.
