# Implementation plan and master checklist

This is the single source of truth for what is left to build. Tick a box only when the acceptance criteria are met, the named tests exist and pass, and `npm run test` plus `npm run typecheck` are green. Then update `PROGRESS.md`.

Task IDs are stable. Use them in commit messages, for example `S1-T15 implement FakeSurfaceDriver`.

From S0-T01 onward, task IDs never change. The plan was renumbered twice before any work started, which is the only time renumbering is free. From here a task that moves keeps its ID, and a task that is removed stays in place, struck through, with a pointer to where its work went. The test in S0-T01 catches a reference to an ID that does not exist. It cannot catch a live ID that has come to mean a different task, which is exactly what happened to ADR 0012, and the freeze is what prevents that.

## How this plan is sliced

The brief asks for a complete vertical slice touching every core requirement and warns against a polished subset. Two earlier versions of this plan failed that test. The first was ordered by layer and reached its first working replay at task forty six. The second called itself sliced and reached the same point at task forty seven, which was a rename rather than a reslice.

This version cuts Slice 1 to what a four step replay against the live application actually needs, and nothing else. Anything whose first genuine consumer is later now lives later, including four things the previous version kept early for no reason. JSON Schema generation, the app profile, the capability writer and the tenant binding.

Two risks drive the order.

* **Schema risk.** A schema nothing has executed is a guess. Replay is still built before discovery, against a hand authored fixture artifact. See ADR 0009.
* **Perception risk.** The target app is built so the accessibility tree alone is not enough. Labels are table cells, so inputs have no accessible name, and layout tables do not reliably expose rows. If the observation format cannot carry that, every type below it changes. See ADR 0012.

### Gates

| Gate | Task | Tasks since the previous gate | What it proves |
| --- | --- | --- | --- |
| Skeleton 1 | S1-T24 | 28 from the start | A hand authored artifact replays against the running app and returns a typed money output |
| Perception | S2-T01 | 1 | A real model drives this surface from our observation format |
| Skeleton 2 | S5-T15 | 37 | Goal to live discovery to reviewed artifact to replay, including a business outcome |
| Skeleton 3 | S6-T15 | 15 | A human takes the live session, acts, hands back, and the run completes |

Twenty eight to Gate 1 is the floor, not a target I stopped short of. The count is granularity rather than scope. Nine of the twenty eight are under an hour each, and the section below lists what was considered for removal and why it stayed.

### Forecast

Days are focused working days of six hands on hours, and exclude review time between gates. No task has run yet, so there is no measured pace behind a single number here. S1-T24 re-forecasts every remaining slice from the hours Slices 0 and 1 actually took.

| Slice | Days | Cumulative | Gate |
| --- | --- | --- | --- |
| S0 Foundation | 1.5 | 1.5 | |
| S1 Thread | 4 | 5.5 | Skeleton 1 |
| S2 Live perception spike | 1 | 6.5 | Perception |
| S3 Harden | 3 | 9.5 | |
| S4 Errors | 5.5 | 15 | |
| S5 Discovery | 7.5 | 22.5 | Skeleton 2 |
| S6 Escalation | 7.5 | 30 | Skeleton 3 |
| S7 Deepen | 3.5 | 33.5 | |
| S8 Deliverables | 2.5 | 36 | |
| S9 Stretch | 0.5 | 36.5 | conditional |

The mandatory tail from the stopping rule is three of those days. The variance sits in three tasks, S1-T16 the web driver, S5-T12 the live run, and S6-T07 CDP forwarding, where integration debugging rather than writing speed sets the pace.


### What Slice 1 does not contain, and where it went

| Moved out | Now in | Because |
| --- | --- | --- |
| JSON Schema generation | S7-T08 | Nothing consumes it until the catalog, and Slice 7 keeps requirement 3.2h off the conditional stretch slice |
| App profile | S4-T01 | It classifies conditions and risk. The thread has one artifact that declares both |
| Capability writer and state sidecar | S5-T10, S7-T03 | One fixture needs a file read, not a canonical writer. Nothing writes an artifact until discovery does |
| Tenant binding | S7-T04 | One tenant until the second one exists. The base URL comes from env config |
| Locator derivation and its record time check | S5-T05, S5-T06 | Derivation serves the recorder. A hand authored bundle needs resolution, not derivation |
| Input validation | S4-T02 | Its failure class belongs with the taxonomy that tests it |
| Redaction, logging, evidence | Slice 3 | Nothing is committed before Slice 3, and that is a rule with enforcement rather than an observation. See Nothing is committed before Harden |
| The `SurfaceDriver` contract suite | S3-T01 | It proves two drivers agree. Until both exist and the thread runs, it compares one thing to itself |
| Lint, Prettier and CI | S3-T02, S3-T03 | The raw timer ban first bites when backoff arrives in Slice 4 |

### Stopping rule

The slice boundaries are real. Stopping after Slice 6 leaves a system that answers every requirement in Section 3 of the brief. It does not leave a submission, because `README.md` and `REPORT.md` are graded deliverables and the evidence scanner is a safety test the protocol forbids cutting.

Stopping after Slice 6 also leaves three requirement rows short. 3.2h needs S7-T08, because that is where an artifact becomes mechanically readable by a calling agent. 3.7b and 3.7c are the two the brief explicitly says may be designed rather than built, so S7-T01 and S7-T03 answer them in code and the report answers the rest.

So wherever work stops, three things always run before submitting. Slice 8 in full, S7-T07 the desktop stub, and S7-T08 the generated schema. The evidence scanner is no longer on this list because it moved into Harden at S3-T08, where it lands before anything can be committed. Budget three days for the tail. An earlier version of this rule said two, and the hour by hour estimate does not support it.

### Nothing is committed before Harden

A rule, not an observation. Until every task in Slice 3 is ticked, nothing produced by running code or a model is committed. That covers spike scripts and their output, model transcripts, screenshots, sample or generated artifacts, cassettes, and anything under `evidence/`. Anything worth keeping waits in `scratch/`, which is gitignored and stays gitignored for the life of the project.

The line is between inputs and outputs. Source, tests, documents and hand authored fixtures are inputs, and each is committed as its task lands. That includes the S1-T19 fixture artifact and the synthetic seed data in `apps/target`. Both are written by a person, neither has a capture path that could pull in real data, and the fixture carries a template for every input value and no literal copied from a seed member row. If that boundary ever feels ambiguous for a specific file, the file waits.

It is enforced rather than remembered. `.gitignore` excludes `/evidence/`, `/capabilities/` and `tests/fixtures/cassettes/` from now. S3-T08 removes those three exclusions in the same commit that turns on the scanner guarding the same paths, so they become committable at exactly the moment something checks them.


---

## Slice 0. Foundation

Four tasks. Everything else that used to be here waits until something needs it.

* [x] **S0-T01** Repo skeleton, `package.json`, TypeScript strict, ESM, Node 22, Vitest, and a first test that guards the plan's cross references.
  * Accept: `npm run typecheck` and `npm run test` both pass. The tree matches `CLAUDE.md` section 4, including `src/core/surfaceModel` and `profiles/`, except `evidence/` and `capabilities/`, which the pre Harden rule keeps out of git until S3-T08. The runner and the skeleton are one task because the first red green cycle needs both.
  * Accept: the first test is not a trivial one. It fails when any document references a task ID that `docs/PLAN.md` does not define. An ID written as `retired` followed by the ID is a deliberate historical reference and is exempt, so correcting the record never breaks the check. It cannot catch a live ID that has come to mean a different task, which is the failure that actually happened in ADR 0012, and the ID freeze in the plan header is what prevents that one. A test that proves only that the runner works would be a wasted first test.
  * Accept: npm scripts land with the task that makes them work, never before. S0-T01 defines `test`, `test:watch` and `typecheck`. `target` lands with S1-T11, `test:integration` with S1-T24, `lint` with S3-T02, `test:all` with S3-T03, `replay` and `test:e2e` with S4-T13, `discover` with S5-T11, `review` with S5-T13, and `serve` with S6-T14. A script defined before it works is a broken script.
  * Test: unit, the reference check reports a planted dead ID in a fixture document and reports nothing for a fixture where every reference is defined. Repo level, the check passes over the committed documents.

* [ ] **S0-T02** `Clock` and `IdProvider`, injected, with deterministic test implementations.
  * Accept: one `Clock` with `now()` and `delay(ms)`, not three overlapping abstractions. `delay` is the only sanctioned delay in the system and is controllable by fake timers.
  * Test: unit, a seeded provider yields the same IDs and timestamps across runs.
* [ ] **S0-T03** Zod validated environment config and `.env.example`. No secret has a default.
  * Accept: the thread needs two values, the target base URL and the fixture credentials. `ANTHROPIC_MODEL` is declared here too so the model ID never lives in a document, per ADR 0011.
  * Test: unit, a missing required var fails fast with a named message.
* [ ] **S0-T04** Perception viability spike. Answers whether ADR 0012 survives the surface this project deliberately built to defeat it. Timeboxed to half a day, of which the first thirty minutes is the mechanism question already agreed.
  * Accept, the surface. A throwaway replica in `scratch/spike/`, never committed, reproducing every hostile property S1-T11 will have. A `<frameset>` with `nav`, `content` and `status` `<frame>` elements. Inside `content`, a form laid out in nested `<table>` elements. A text input whose only label is a sibling `<td>` reading `Member  ID:` with two spaces, with no `<label for>`, no `aria-label`, no `title` and no `placeholder`. A second input one row below it with a different label, so a wrong row binding is detectable rather than invisible. A `<td onclick>` submit carrying inner text only. Generated element IDs.
  * Accept, the mechanism. Does the installed Playwright expose aria-ref locator resolution, as its MCP server uses. If yes, use it. If no, CDP `Accessibility.getFullAXTree` per frame, `backendDOMNodeId` resolved through `DOM.resolveNode`, and geometry from `DOM.getBoxModel`.
  * Accept, what unusable means. Five named failures, checked in order. Any one of them fails the spike.
    * **F1, no node.** The unlabelled input does not appear in the accessibility tree at all, so there is no ref a model could choose.
    * **F2, no handle.** A node appears but its ref cannot be resolved to an element inside the `content` frame that accepts a fill. The model could choose it and nothing could act on it.
    * **F3, no label geometry.** The text `Member  ID:` is absent from the tree, or present without a bounding box, so `derivedLabel` has nothing to compute from. This is the case where Chromium has flattened the layout tables and geometry cannot recover the label.
    * **F4, wrong label.** Geometry recovers a label, but the nearest text in the same row band is not `Member  ID:`, or the input one row below also claims it. This is the dangerous one, because it passes every smoke test and binds the wrong field.
    * **F5, invisible control.** The `<td onclick>` submit yields no node carrying both its text and a box, so there is nothing to click by ref.
  * Accept, what passing means. The input has a node, a handle that fills in the correct frame, a box, and a `derivedLabel` of `Member  ID:` that no other input shares, and the submit has a clickable node. The chosen mechanism and the observed result for each of F1 to F5 are written into ADR 0012 as an amendment.
  * Accept, what happens on failure. Stop. Record which of F1 to F5 fired, with the raw output, in `PROGRESS.md`. Do not start Slice 1, do not patch around it, and raise it as a design decision. Plan B is a proposal to be decided, not a fallback to execute.
  * Plan B, DOM primary perception with accessibility enrichment. The web driver builds `UINode` by walking each frame's DOM, takes role and name from the accessibility tree where they exist, and derives labels from table structure as well as geometry, meaning the text of the preceding cell in the same `<tr>`. The `UINode` contract in core does not change.
    * **Supersedes** ADR 0012 with a new perception ADR. It weakens the answer to the brief's instruction to bias toward an approach that works without a clean DOM, because on the web the driver would be reading the DOM, and `REPORT.md` would have to say so plainly rather than claim accessibility first.
    * **Reworks** nothing already built, because nothing is. At S0-T04 the cost is specification. S1-T16 roughly doubles, from about one day to about two. If F4 fired, `Relation` gains a structural variant, which widens S1-T01 and S1-T02 by about half a day between them.
    * **Costs** about one and a half to two days if decided at S0-T04. The same failure discovered at S1-T16 or S2-T01 costs three to four, because S1-T01, S1-T02 and S1-T16 would already exist and be wrong. That difference is the reason this spike runs before anything else.
    * There is no plan C worth writing. The replica is our own HTML, so DOM access is guaranteed. If plan B fails as well, that is a bug to find and not a design limit.


---

## Slice 1. Thread

Read `docs/ARTIFACT_SCHEMA.md`, `docs/ARCHITECTURE.md` sections 3 to 7, and `docs/SAFETY.md`.

Twenty four tasks ending at gate S1-T24. Every one of them is on the path to a four step replay that returns a typed money output. Recovery, classification, evidence, overlays and drift are all absent on purpose.

### Core domain, zero IO

* [ ] **S1-T01** Surface model types in `src/core/surfaceModel`. `UINode`, `Observation`, `Box`, `Relation`, the eleven verb action vocabulary, `ResolvedAction`, `ActionResult`.
  * Accept: `UINode` carries `ref`, `role`, `name`, `derivedLabel`, `value`, `state`, `framePath`, `box`, `children` and an opaque `raw`. `Observation` carries per frame URL and last navigation status, so an `httpStatus` matcher has something to read later. No Playwright type appears in `src/core` and no browser concept appears in the vocabulary. `src/surface/types.ts` imports these rather than defining them, because the capability schema needs the action vocabulary and the dependency direction is inward.
  * Test: unit and type level, the vocabulary is exhaustive and adding a verb without handling it fails to compile.
* [ ] **S1-T02** `LocatorBundle` and `LocatorStrategy` types and the resolution policy, as a pure function over a driver supplied `match(strategy)` port.
  * Accept: kinds are `role-name`, `test-id`, `label`, `text`, `anchor-relative` and `structural`. No `visual`, cut by ADR 0013. `matchPolicy` is `unique` or `nth`, never `first`. Relations are geometric. Strategy text fields are `TemplateExpr`. Core owns ordering, ambiguity rejection and degradation recording, so the ladder exists once instead of once per driver.
  * Accept: derivation from a `UINode` is not here. It serves the recorder and lands at S5-T05.
  * Test: unit, the first resolving strategy wins, an ambiguous strategy under `unique` is skipped, all ambiguous yields `LocatorAmbiguous`, a lower ranked win is recorded as drift.
* [ ] **S1-T03** Capability Zod schema, top level shape, types inferred.
  * Accept: `steps[].effect` is read or write and `steps[].idempotent` is a boolean, per ADR 0014. `policy` has `allowReauth` and no `allowedOrigins`. `lifecycle` has no stability counters. There is no `extract` step kind. Outputs declare their own bundle and resolve after the step named in `source.stepId`.
  * Test: unit, a valid fixture parses and every module boundary is explicitly typed.
* [ ] **S1-T04** Schema refinements. One test per refinement, each asserting its specific error.
  * Accept, the refinements the thread exercises. Step IDs unique. `index` agrees with array order. Output `source.stepId` references an existing step. `outputResolvable` names a declared output. Template references name a declared input, an earlier output, or an allowlisted env key. Every acting step carries a postcondition, because we never assume a click worked and because the executor races that postcondition against detectors later.
  * Accept, deferred with owners so they cannot be lost. No retry on a non idempotent step, S4-T06. A step rule classified `business_outcome` uses a declared code, S4-T04. `enumValues` with enum and `nth` with `nth`, S4-T02. `approvedBy` with approved status, S5-T13.
  * Accept: `redactionApplied` is a marker that the writer ran, not an enforcement. The enforcement is the writer scan at S5-T10. A literal in a schema cannot know where a value came from.
* [ ] **S1-T05** Load a capability from disk, parse it, refuse an unsupported `schemaVersion`.
  * Accept: a file read and a parse. There is no canonical writer, no index and no state sidecar yet, because nothing writes an artifact until S5-T10.
  * Test: unit, a fixture loads, and a future version is refused with `SchemaIncompatible`.
* [ ] **S1-T06** Template resolution over `inputs`, prior `outputs` and allowlisted `env`. No expression language.
  * Test: unit, resolves each scope, an unresolved reference is a hard failure before any action, a literal passes through, escaped braces are handled.
* [ ] **S1-T07** Result contract types, the `FailureClass` union, and constructors that require `expected` and `observed`.
  * Accept: `ResultBase` carries `inputNames` rather than `inputsHash`, and carries `interventions[]` next to `recoveries[]` per ADR 0016. There is no `resumeToken`.
  * Test: unit, each failure class is constructible. A type level exhaustiveness check under `vitest --typecheck` fails when a member is added without handling.
* [ ] **S1-T08** `ConditionMatcher` evaluation against an `Observation`, all kinds including `all`, `any` and `not`.
  * Accept: one matcher language. A `Checkpoint` is a description plus a matcher plus a timeout, so the near duplicate `Assertion` union and its second evaluator never exist.
  * Test: unit, one per kind, positive and negative.
* [ ] **S1-T09** Money parser handling `$4,250.75`, `4250.75 USD`, `(125.00)` and `$0.00`.
  * Accept: amount in minor units, a currency, and the raw text it came from. That raw text is `pii`.
  * Test: unit, all formats, negative handling, an unparseable string is a typed failure and never a `NaN`.
* [ ] **S1-T10** `PolicyEngine.authorize`, three valued, with allowlist loading and validation.
  * Accept: origin, path glob and action kind come from `policy/allowlist.yaml`. Denied beats allowed. Unknown means deny. The verdict for confirmation reads the step's declared `effect`, because the artifact carries it. The profile cross check that classifies effect independently arrives at S4-T01, and until then a capability is trusted about its own steps and the allowlist still caps what is reachable.
  * Test: unit, the origin and path table from `docs/SAFETY.md` section 6, plus an unknown action kind yielding deny.

### Target application fixture

Read `docs/TARGET_APP.md`. Two tasks, not nine. It is a fixture and `CLAUDE.md` section 9 says to timebox it, so it gets one task for the four screens the thread needs and one for the test controls. The faults, the write flow and the second tenant arrive when the slices that test them do.

* [ ] **S1-T11** MERIDIAN Core, the four screens. Frameset shell with nav, content and status frames. Login with a session cookie and a redirect. Member search with results. Member detail with the accounts table.
  * Accept: nested table layout, no test IDs, generated element IDs seeded per process from a fixed seed so an observation hash is stable across runs. The two hostile controls from `docs/TARGET_APP.md` section 3 are present. The submit is a `<td onclick>` carrying inner text only, with no role and no `title`, because Chromium feeds `title` into the accessible name and a nameable control would never exercise the fallback. One label reads `Member  ID:` with two spaces.
  * Accept: three balance formats across the seed members, because S1-T09 parses all three.
  * Test: integration, each route returns 200, the frameset contains three frames, an unauthenticated request redirects, a known ID returns a row, and the hostile control has no accessible name.
* [ ] **S1-T12** `/__control__/**` mounted only under `TARGET_TEST_MODE=1`, with reset and state.
  * Test: integration, unmounted without the flag, and denied by the allowlist when it is mounted.

### Surface and control

* [ ] **S1-T13** The `SurfaceDriver` interface.
  * Accept: `src/surface/types.ts` holds the interface and nothing else. The contract suite that proves two implementations agree is S3-T01, once there are two.
* [ ] **S1-T14** `ControlToken` issuance, rotation and enforcement.
  * Accept: `act()` takes a token and throws `ControlLostError` if it is not current. The seven state reducer is S6-T01 territory, but the token is not, because the driver signature depends on it and retrofitting a required argument through every call site later is worse than writing it now.
  * Test: unit, a token held across a rotation is rejected afterwards.
* [ ] **S1-T15** `FakeSurfaceDriver`, in memory tree with scripted transitions.
  * Accept: it exists at this point so the executor, and later the agent loop and the control plane, are unit testable without a browser. Without it every executor test needs Chromium and the pyramid inverts.
* [ ] **S1-T16** `WebSurfaceDriver`. Playwright, accessibility tree normalisation with geometry and derived labels, frame traversal, ref assignment in document order, act, and `match(strategy)` for the core resolver.
  * Accept: implements the mechanism S0-T04 chose. Ref assignment is deterministic, which ADR 0017 depends on later.
  * Test: integration, the member ID input resolves through `anchor-relative` even though it has no accessible name, and the frame path is correct for a control inside the content frame. This is the case the whole perception design exists for.
* [ ] **S1-T17** `SessionBroker`. Owns the Playwright context, logs in before the session is leased, exposes CDP.
  * Accept: authentication is a session concern and never a capability step, so no artifact carries a credential. A `context.route` handler refuses any request to an origin or path outside the allowlist, which is the one control that will still apply while a human holds the session.
  * Test: integration, a leased session is already authenticated, and a request to a denied path is refused at the network layer.
* [ ] **S1-T18** `GuardedSurface` wrapper enforcing `PolicyEngine.authorize` and the control token.
  * Accept: `authorize` has exactly one call site. The executor reads the verdict as a typed value rather than calling authorize itself, so the choke point is genuinely single.
  * Test: unit, a denied action never reaches the driver, and an import graph test proves `replay` cannot reach the raw driver.

### Replay

* [ ] **S1-T19** A hand authored fixture artifact for `member.readSavingsBalance` at `tests/fixtures/capabilities/`.
  * Accept: validates against the schema. `app.entryPath` is `/servicing`, the frameset shell, and every `navigate` declares its `framePath`. Pointing the top level document at a content frame URL destroys the frameset and makes every later `framePath` unresolvable.
  * Accept: this is a test fixture and never the evidence artifact. ADR 0018 says where the real one comes from.
* [ ] **S1-T20** `ReplayExecutor` step state machine and its result. Resolve, wait, authorize, act, checkpoint, advance.
  * Accept: assembly of `ReplayResult` is part of this task rather than its own. With no recoveries, no drift and no evidence bundle yet, there is nothing to assemble separately. It becomes its own concern at S4-T11.
  * Test: unit against `FakeSurfaceDriver`, the happy path returns success with typed outputs.
* [ ] **S1-T21** Condition based `waitFor` with bounded timeouts and the condition description in the timeout message.
  * Test: unit, resolves on the condition, and times out with the description present in the error.
* [ ] **S1-T22** Checkpoint evaluation producing `CheckpointFailed` with `expected` and `observed`.
  * Test: unit, a passing checkpoint advances and a failing one produces the typed failure with both strings populated.
* [ ] **S1-T23** Output extraction and typing, with `OutputUnresolvable` on a missing required output.
  * Accept: outputs resolve after the step named in `source.stepId`, through the same resolution policy as any action target. Reading a balance is exactly as failure prone as clicking a button.
  * Test: unit and integration, money parsed to a typed value, and a missing required output is a hard failure rather than a silent undefined.
* [ ] **S1-T24** **Gate, Skeleton 1.** The fixture artifact replays against the live target app and returns a typed money output.
  * Test: integration, `member.readSavingsBalance` for member `10001` returns `success` with `savingsBalance` of 425075 minor units in USD. No evidence directory yet, because the evidence sink is S3-T07 and a gate that waits for it is a gate that moved.
  * Accept: re-forecast. Record the hours Slices 0 and 1 actually took in `PROGRESS.md`, and re-forecast every remaining slice from that measured pace. Every estimate before this point is unmeasured.

---

## Slice 2. Live perception spike

The one thing design review cannot answer. Do not skip it and do not polish it.

* [ ] **S2-T01** **Gate, Perception.** A throwaway loop in `scratch/spike/`, never committed, real model, real target app, refs only tool surface, no policy, no recorder, no artifact.
  * Accept: does a real model reach the savings balance for member `10001` from our observation format, in under twenty steps. The loop and its transcript stay in `scratch/spike/`, never committed, because this is not the deliverable run and because nothing is committed before Harden.
  * Accept: findings land in `PROGRESS.md`, and if the observation format has to change, as an amendment to ADR 0012 plus S2-T02.
* [ ] **S2-T02** Fold the spike findings back into `src/core/surfaceModel` and the observation builder contract. Conditional. If nothing needs changing, tick it with a note saying so, which is itself a result.

---

## Slice 3. Harden

Eight tasks. Seven the thread deferred, plus the evidence scanner, whose commit lifts the rule that nothing is committed before this slice. They come first after the two gates because everything from here on persists something, and redaction has to exist before the first byte is written rather than after.

* [ ] **S3-T01** `tests/contract/surfaceDriver.contract.ts`, the full suite from `docs/TESTING.md` section 5, run against both drivers.
  * Accept: a reusable function parameterised over driver factories, not a test file bound to one implementation. It lands here because it compares two implementations, and until Slice 1 finished there was only one.
  * Test: `FakeSurfaceDriver` and `WebSurfaceDriver` both pass, including `derivedLabel` on an unnamed node and a geometric relation.
* [ ] **S3-T02** ESLint and Prettier, plus the rule that bans raw timers.
  * Accept: `no-restricted-globals` refuses `setTimeout`, `setInterval` and `setImmediate` in `src/core`, `src/replay`, `src/discovery` and `src/control`. The only sanctioned delay is `Clock.delay`. The rule lands before S4-T06 introduces backoff, which is the first code that would reach for a raw timer.
* [ ] **S3-T03** GitHub Actions workflow, plus the suite level guards that the recut left without an owner.
  * Accept: CI installs Chromium, references no secret, and leaves `ANTHROPIC_API_KEY` unset so a live call cannot happen by accident. It runs every script that exists, and each later script is added to the workflow by the task that creates it.
  * Accept: Vitest projects for unit, contract, integration and e2e, and the coverage gates from `docs/TESTING.md` section 7. Both belonged to a Slice 0 task the recut removed, and nothing picked them up. `test:all` lands here.
  * Accept: the setup guard that fails the suite if a socket opens to anything other than loopback, which `docs/TESTING.md` section 4 promises and which also lost its owner in the recut.
  * Test: the loopback guard fails a fixture test that opens a socket to a non loopback address, and passes one that talks to the target app on `127.0.0.1`.

* [ ] **S3-T04** `Redactor`, pattern based plus provenance based, with Luhn validation and object traversal.
  * Accept: patterns load from the allowlist with an explicit `flags` field. Inline `(?i)` is PCRE syntax that JavaScript rejects when it constructs the expression, so it appears nowhere.
  * Test: unit, every pattern positive and negative, Luhn rejects an invalid number, redaction is idempotent, nested arrays are traversed.
* [ ] **S3-T05** Sensitivity propagation as a pure function.
  * Test: unit, an output from a secret sourced field inherits secret, public stays public.
* [ ] **S3-T06** Structured JSON lines logger with a pluggable sink, redaction at the sink, run scoped correlation IDs.
  * Accept: depends on the real `Redactor`. `docs/TESTING.md` section 3 allows three test doubles and a stub redactor is not one of them.
  * Test: unit, lines are valid JSON, carry `runId`, and pass through the redactor.
* [ ] **S3-T07** `EvidenceSink` writing logs, screenshots, snapshots and the run manifest to `evidence/<phase>/<runId>/`.
  * Accept: masking uses Playwright's own screenshot mask option so unmasked bytes never exist in the process. Masks come from the profile sensitivity map once S4-T01 lands, and from an explicit list until then. Two projections are named. The caller projection carries real output values, the persisted projection is redacted.
  * Test: unit, the manifest lists every artefact. Integration, a masked region is absent from the stored image, sampled by pixel.
* [ ] **S3-T08** The evidence scanner, permanent, part of the suite. Never cut. Its commit lifts the rule that nothing is committed before Harden.
  * Accept: it scans `evidence/`, `capabilities/` and `tests/fixtures/cassettes/`. The cassette is a committed model transcript and would otherwise go unscanned. It searches for seeded canary literals, meaning the seed member names, the seed balances, the member IDs and a Luhn valid card number planted in the fixture, as well as the redaction patterns. A scanner that knows only the redactor's own patterns can only find what the redactor would already have caught, which makes it close to a tautology.
  * Accept: moved here from Slice 7. There it would have run two slices after the first evidence was committed. It belongs in the slice whose whole job is making commits safe.
  * Accept: removes the `.gitignore` exclusions for `/evidence/`, `/capabilities/` and `tests/fixtures/cassettes/` in the same commit that turns the scanner on. Those paths become committable at exactly the moment something checks what lands in them.
  * Test: unit, the scanner fails on a planted canary and passes on the committed tree.


---

## Slice 4. Errors

Read `docs/ERROR_TAXONOMY.md` in full.

* [ ] **S4-T01** App profile schema, loader, and `profiles/meridian-core.json`.
  * Accept: the route plus method table that classifies `effect` and `idempotent`, the field level sensitivity map, and the application wide detectors such as the login redirect and the generic error banner. An action with no entry defaults to write and not idempotent, so it fails closed. The profile now cross checks what a capability declares about its own steps, which S1-T10 took on trust.
  * Test: unit, a profile validates, an unknown route classifies as write, the sensitivity map marks the member name and balance cells `pii`, and a capability whose declared effect contradicts the profile is refused.
* [ ] **S4-T02** Input validation against `ParamSpec` constraints, running before any surface is opened.
  * Accept: also carries the two schema refinements that belong to its fields, `enumValues` present exactly with an enum type and `nth` present exactly with an `nth` match policy.
  * Test: unit, pattern, min, max, required, enum. Failure is `InputValidation`.
* [ ] **S4-T03** All eleven faults from `docs/TARGET_APP.md` section 5, plus the no records banner and the restricted member.
  * Accept: every fault is route scoped and deterministic, armed through `POST /__control__/fault` with a count. `slow` takes a fixed configurable delay. `surpriseDialog` renders an HTML modal, not a native dialog, because Playwright auto dismisses native dialogs when no handler is registered, which is precisely the click through this system must never perform, and because a native dialog is invisible to a screenshot and unreachable by forwarded CDP input.
  * Test: integration, one per fault asserting the documented behaviour. This suite protects every downstream error test.
* [ ] **S4-T04** Outcome classifier with a single total precedence order.
  * Accept: step detectors, then capability outcomes, then app profile. Within a tie, business outcome beats failure. Nothing else. The app profile may classify recoverable, escalate or failure, and may never declare a business outcome, because an undeclared code would reach a calling agent that cannot know it exists. Also carries the refinement that a step rule classified `business_outcome` uses a code declared in `outcomes`.
  * Accept: the failure case is postcondition failed and no detector matched. An unclassifiable state returns `Internal`, never a guess.
  * Test: unit, table driven over the precedence matrix, including the case where specificity and category used to disagree.
* [ ] **S4-T05** The classification race in `waitFor`.
  * Accept: after acting, the executor waits on `any(postcondition, capability outcomes, profile conditions)` and classifies whichever fired. Waiting on the postcondition alone means every business outcome costs a full timeout and then reports as `Timeout` or `CheckpointFailed`.
  * Test: integration, a search for `00000` classifies `MEMBER_NOT_FOUND` well inside the step timeout.
* [ ] **S4-T06** Retry policy, bounded, exponential backoff through `Clock.delay`, only on idempotent steps.
  * Accept: gated on `idempotent`, not on `effect`. A search POST is a read that is not idempotent. Also carries the schema refinement that forbids a retry policy on a non idempotent step.
  * Test: unit with fake timers, backoff timing, and a non idempotent step is never retried.
* [ ] **S4-T07** Recovery handlers for `TransientLoad`, `KnownInterstitial`, `StaleElement` and `SessionExpired`, each bounded and each recorded in `recoveries`.
  * Accept: `SessionExpired` re authenticates through the session broker, then restarts the capability from step zero if and only if every completed step was a read. After a re login the browser is at the landing page, so resuming from the current precondition cannot work, and replaying a completed write would be a double post.
  * Test: unit for the bounds, integration for each against its fault.
* [ ] **S4-T08** `UnexpectedDialog` escalates and never auto dismisses.
  * Accept: a native dialog handler is registered that neither accepts nor dismisses. It captures and escalates.
  * Test: integration against `surpriseDialog`, asserting no click was dispatched and a screenshot was captured.
* [ ] **S4-T09** Budgets and the rate limit.
  * Accept: max steps, max duration, and `maxActionsPerMinute` which throttles through `Clock.delay` rather than failing, because respecting a legacy application is politeness and not an error. Budget exhaustion is a failure and never an escalation.
  * Test: unit with fake timers, each budget terminates the run and the throttle delays rather than denying.
* [ ] **S4-T10** Import graph test proving `src/replay` contains no model client.
* [ ] **S4-T11** `ReplayResult` assembly with `recoveries`, `drift` and the evidence bundle, now that all three exist.
  * Test: unit, a run with two retries reports them on a successful result rather than hiding them.
* [ ] **S4-T12** The integration matrix from `docs/ERROR_TAXONOMY.md` section 8, minus the four write flow rows which need S6-T13.
  * Accept: the locator drift row uses the `relabel` fault rather than the second tenant, so the matrix does not depend on a task the protocol lists as cuttable.
  * Test: integration, one per row, each asserting the exact status and code.
* [ ] **S4-T13** `npm run replay` CLI taking a capability ID, a version, a variant and inputs.
  * Accept: inputs arrive on stdin or from a file, never as argv, because a member ID in a shell history is a small leak that costs nothing to avoid.
  * Test: e2e, exits 0 on success and non zero on failure, and the printed result is valid JSON.

---

## Slice 5. Discovery

Read `docs/ARCHITECTURE.md` section 6 and ADRs 0013, 0017 and 0018.

* [ ] **S5-T01** `ModelClient` interface plus `FakeModelClient` and `CassetteModelClient`.
  * Accept: cassette matching is positional with a shape assertion, per ADR 0017. Exchange N answers the Nth call, and the client asserts the tool set and the observation hash match what was recorded.
  * Test: unit, deterministic replay, and a changed observation hash fails with a diff rather than replaying the wrong turn.
* [ ] **S5-T02** Observation builder. Prune to interactive and text bearing nodes, assign refs in document order, attach derived labels, apply redaction before the prompt is built.
  * Accept: redaction uses the profile sensitivity map, so a member name is masked even though no regex would find it.
  * Test: unit, a large tree prunes below the token budget, and a fixture observation contains no unredacted PII.
* [ ] **S5-T03** Prompt construction and the tool schema, versioned by `promptVersion`.
  * Accept: the model's tools are refs only. `click`, `fill` with an input name, `select`, `press`, `navigate`, `extract` with an output name and type, `escalate`, `done`. It is never given `waitFor` or `assert`, because both take conditions and locators, and a model that authors either has authored a locator. This is ADR 0013, and it is why the tool set deliberately does not mirror the driver vocabulary.
  * Test: unit, tool definitions asserted programmatically against the allowed subset so the two cannot drift together.
* [ ] **S5-T04** `AgentLoop`. Observe, decide, authorize, act, record, with all stopping conditions.
  * Test: unit with `FakeModelClient`, stops on done, on max steps, on max duration, on no progress. A denied action never reaches the driver. A bad ref produces a corrective observation rather than a crash.
* [ ] **S5-T05** Locator derivation from a `UINode`, producing an ordered bundle.
  * Test: unit, a named node yields `role-name` first. An unnamed input in a table row yields `anchor-relative` from its `derivedLabel`. A generated ID is ranked low. A strategy whose text equals a declared input value is emitted as a template, so a member ID never lands in an artifact as a literal.
* [ ] **S5-T06** Record time strategy verification, per ADR 0013.
  * Accept: every derived strategy is resolved against the live observation. One that does not uniquely resolve to the recorded element is dropped, not ranked low, so a later drift signal means something.
  * Test: unit, a bundle derived on a page with two matching rows drops the ambiguous `text` strategy and keeps the `anchor-relative` one.
* [ ] **S5-T07** `Recorder` deriving a bundle from the real element at action time, never from model output.
  * Test: unit, the recorded bundle contains only verified strategies, and the model's text output is never used as a selector.
* [ ] **S5-T08** `RunTrace` persistence, the full raw record, separate from the artifact.
  * Accept: each acted element's redacted neighbourhood is stored, so re deriving locators from a trace is real rather than claimed. ADR 0004 claimed it while the capture policy made it impossible.
  * Test: unit, a trace round trips and contains observation hashes and authorization decisions.
* [ ] **S5-T09** `Generalizer`, the six transforms, as a pure function.
  * Accept: discovery success is not circular. The model calls `done`, the generalizer synthesizes a success condition from the final observation, and that condition is re asserted against that same observation. If it does not hold, the run did not succeed, which also catches a model declaring victory on the wrong screen.
  * Test: unit, one per transform. A fixture trace snapshot compares against an expected artifact. A sensitive literal is never emitted, asserted by scanning the JSON.
* [ ] **S5-T10** `CapabilityStore` writer. Canonical JSON with stable key order, the index, and the refusal scan.
  * Accept: the writer scans the serialised artifact for declared input values and redactor matches, and refuses to write on a hit. This is the enforcement that `redactionApplied` only marks.
  * Test: unit, a round trip is byte stable, and an artifact carrying a sensitive literal is refused.
* [ ] **S5-T11** `npm run discover` CLI taking a goal, a target and an input schema, writing the artifact plus evidence.
  * Accept: discovery returns a typed `DiscoveryResult` of produced, escalated or failed, carrying the same evidence bundle shape a replay returns. The goal is templated, `look up member {{inputs.memberId}}`, with values supplied separately, so the goal string never carries PII into the prompt or the evidence.
* [ ] **S5-T12** The real live discovery run against the target app with a real key. Commit the evidence.
  * Accept: `evidence/discovery/<runId>/` holds the transcript, the trace, screenshots and the produced artifact at `1.0.0`, status draft. This satisfies the brief's one non negotiable requirement.
* [ ] **S5-T13** Negative probe review, per ADR 0018. `npm run review` replays the draft with a probe input, stops where the postcondition fails, and lets a reviewer name the outcome while the recorder derives the detector from the real element.
  * Accept: emits `1.1.0` with `MEMBER_NOT_FOUND` declared and `provenance: 'manual'`. The same command approves a capability, writing `status`, `approvedBy` and `approvedAt`, so who approved what is answerable from git history. Carries the refinement that the approval fields are present exactly when the status is approved.
  * Test: integration, the probe against `00000` produces a detector that resolves on the banner, and the bump classifies as minor.
* [ ] **S5-T14** Record the cassette from the live run and wire it into the E2E test.
  * Test: e2e, the full thread runs offline with no network and no key.
* [ ] **S5-T15** **Gate, Skeleton 2.** Replay the reviewed `1.1.0` artifact twice and commit both runs.
  * Accept: `evidence/replay/success/` for member `10001`, and `evidence/replay/businessOutcome/` for `00000` returning `business_outcome` with `MEMBER_NOT_FOUND`. The artifact replayed here is the discovered one and not the S1-T19 fixture, so the thread from goal to outcome is continuous.

---

## Slice 6. Escalation and operator handoff

Read `docs/ESCALATION.md` in full, and ADRs 0014 and 0016.

* [ ] **S6-T01** The control state reducer, the seven states and every transition, as a pure function.
  * Accept: the token from S1-T14 already exists. This adds the state machine around it.
  * Test: unit, every legal transition, every illegal transition throws, table driven over the full matrix.
* [ ] **S6-T02** The six stuck detectors, each independently testable.
  * Test: unit, each fires on its condition and stays silent otherwise. `NoProgress` uses the accessibility hash, proven by a test where only a timestamp on the page changed.
* [ ] **S6-T03** `InterventionRequest` construction with every required field, redacted. No `resumeToken`, per ADR 0016.
  * Test: unit, all fields present, and the payload contains no unredacted PII.
* [ ] **S6-T04** `InterventionStore` interface plus an in memory implementation.
  * Accept: no filesystem journal. A restored intervention would point at a browser that died with the process, so the journal was audit theatre. Evidence is the durable record.
* [ ] **S6-T05** Operator HTTP and WebSocket API, hosted by the run process, all eight endpoints from `docs/ESCALATION.md` section 5.
  * Accept: the run blocks in `pending_human` and prints the intervention URL to stdout, so the handoff is demonstrable from a terminal instead of merely present in the code. `POST /sessions/:id/input` requires the current human token, because that path never passes through `act()` and does not inherit its fencing.
  * Test: integration, each endpoint. Claim transfers control, release returns it, and an input request with a stale token is refused.
* [ ] **S6-T06** Screenshot streaming over WebSocket, throttled and masked.
  * Test: integration, frames arrive, masking is applied, the stream stops on release.
* [ ] **S6-T07** CDP input forwarding, mouse and keyboard, into the same live page.
  * Accept: before dispatching, the forwarder hit tests the coordinate with `DOM.getNodeForLocation` and runs the normal recorder on the result, so a human action produces a real `LocatorBundle` rather than a role and a name. A role and a name cannot be replayed, which would make the draft steps in S6-T10 useless. It also works across frames without instrumenting the page.
  * Test: integration, a forwarded click changes page state, proving it is the same session, and produces a bundle that resolves.
* [ ] **S6-T08** Human action recording.
  * Accept: typed values are never captured, not even redacted with a length. The value is not needed, because a human filled field becomes an input template on the draft step.
  * Test: integration, a click and a fill both appear as `HumanActionRecord` with a derived target, and no value appears anywhere in the record.
* [ ] **S6-T09** Resume revalidation, every branch from `docs/ESCALATION.md` section 7.
  * Test: unit, one per branch. Specifically, when the human completed the whole task the run reports success without re acting.
* [ ] **S6-T10** Human actions converted to draft steps with `provenance: 'human'`, requiring approval.
  * Test: unit, draft steps appear on a new revision and the approved artifact is unchanged.
* [ ] **S6-T11** Policy `confirm` verdicts routed through the intervention channel, resolved by a one shot approval grant.
  * Accept: release carries a grant bound to run, step and resolved target. Without it the resumed step re authorizes, is told to confirm again, and escalates forever. That loop is why ADR 0014 exists.
  * Test: integration, a write step raises an intervention, proceeds once after approval, and a second attempt on the same step raises again rather than reusing the grant.
* [ ] **S6-T12** The write flow in the target app. Sub account form, field level validation, confirmation screen, and the `validation` fault.
  * Test: integration, a valid post reaches confirmation and an invalid post returns a field error.
* [ ] **S6-T13** `member.openSubAccount`, the write capability. Requirement 3.4 is unproven without it, so the protocol lists it as uncuttable.
  * Accept: covers what the read flow cannot. A write step confirms during a draft replay and runs unattended once the capability is approved and declares `allowUnattendedReplay`. The submit is not idempotent, so a 503 on it is never retried and recovery re evaluates the postcondition instead, which is the double post safety story. A field level validation error is a declared business outcome with its message captured as structured data.
  * Accept: also defines attended. A draft replay is attended, meaning the operator API is reachable and a confirm can be answered. An approved capability with `allowUnattendedReplay` runs with nobody there, and a confirm in that state is a failure rather than a silent wait.
  * Test: integration, the four write rows of the matrix in `docs/ERROR_TAXONOMY.md` section 8.
* [ ] **S6-T14** `npm run serve` starting the operator console with no run attached, for reading past interventions and later for the catalog.
* [ ] **S6-T15** **Gate, Skeleton 3.** Commit an escalating replay to `evidence/replay/escalated/`, using `surpriseDialog`, including the intervention payload and the handoff log.
  * Accept: the committed run shows the full cycle. Escalate, claim, human acts on the live session, release, resume, and a final result carrying the intervention in `interventions[]`.

---

## Slice 7. Deepen

* [ ] **S7-T01** Overlay schema and typed merge, per ADR 0015.
  * Accept: an overlay may override bindings. `steps[].target`, `steps[].value`, `outputs[].source`, `outcomes[].detect`, `app.baseUrl`, and it may add `onCondition` rules and mark a step optional. It may not change a contract. Every overlay declares `appliesTo`, a semver range over base versions, and may declare `extends`.
  * Test: unit, a locator override applies, an output binding override applies, an attempt to change an output type is rejected, and an overlay outside its range refuses to load.
* [ ] **S7-T02** Version bump rules, classifying a diff between two artifacts as patch, minor or major.
  * Test: unit, fixture pairs for each class, including the S5-T13 review producing a minor bump.
* [ ] **S7-T03** `surfaceFingerprint` capture and comparison, drift records, and the state sidecar.
  * Accept: a mismatch does not fail the run. It increments drift in `capabilities/<id>/state.json` and marks the variant `needs_review`, which is sidecar state and not an artifact status.
  * Test: unit, a mismatch produces a drift record and flips the sidecar flag without touching the artifact file.
* [ ] **S7-T04** Tenant binding. Schema plus resolution of `baseUrl`, tenant selector and credential reference at invocation time.
  * Test: unit, a capability with no `baseUrl` resolves against a binding, and a missing binding is a typed failure rather than a malformed URL.
* [ ] **S7-T05** Tenant variants `acme` and `borealis`, selected by `Host`.
  * Accept: both origins are in the allowlist, so tenant selection never needs a policy exception.
  * Test: integration, `borealis` renders `Member Number`, includes the branch dropdown, moves the balance column, and shows the post login interstitial.
* [ ] **S7-T06** Cross tenant reuse. Replay the `acme` artifact against `borealis`, failing first, then passing with a sparse overlay. Commit both runs.
  * Accept: the overlay rebinds the member ID locator and the balance output. Rebinding an output is the case ADR 0007 forbade and ADR 0015 permits, and it is the most common real difference between two tenants on one product.
  * Accept: explicitly cuttable. See the time pressure protocol.
  * Test: integration, without the overlay it fails with `LocatorNotFound` listing every attempted strategy, and with the overlay it succeeds.
* [ ] **S7-T07** `DesktopSurfaceDriver` stub implementing the interface, throwing `NotImplementedError`, with the verb to UI Automation mapping table in its doc comment.
  * Accept: the mapping includes how geometric relations map to UI Automation bounding rectangles, which is what makes the seam credible rather than decorative. Never cut, because it is the cheapest proof of requirement 3.7a in the repository.
  * Test: unit, the class satisfies the interface type and every verb throws with a named message.
* [ ] **S7-T08** JSON Schema generation from the capability schema, plus a human readable review sheet.
  * Accept: generated from Zod, so there is one definition and three consumers. It sits here rather than in Slice 9 so requirement 3.2h does not rest on a conditional stretch task.
  * Test: unit, the generated tool schema names every required input with its type, and the review sheet lists every step intent and every declared outcome.
* [ ] **S7-T09** `evidence/README.md`, written for a reviewer with limited time. One or two sentences per directory, naming the single most interesting file in each.

---

## Slice 8. Deliverables

Always runs, wherever the work stopped. See the stopping rule.

* [ ] **S8-T01** `README.md`. Setup, config, the exact demo command sequence, how to run without live services, and a clear statement that `apps/target` is a fixture and that the Express and Fastify split is deliberate.
  * Accept: names exactly what a reviewer needs to reach the app. The hosts file entries for `acme.localhost` and `borealis.localhost`, or the statement that Chromium resolves them without one and that only a non browser client needs the entry. A reviewer who cannot start the app scores the submission on nothing.
  * Accept: a reader following it from a clean clone reaches a successful replay. Verify literally, on a clean clone.
* [ ] **S8-T02** `REPORT.md`, one to three pages, first person.
  * Accept: the seven headings use the brief's exact wording, ampersands and hyphen included. Architecture, Artifact schema, Determinism & error handling, Heterogeneity & multi-tenant, Escalation & handoff, Safety, Cuts. The repository style rules do not override a graded instruction.
* [ ] **S8-T03** Walk `docs/REQUIREMENTS.md` end to end. Every row has a ticked task and a named passing test, or an entry in Cuts.
* [ ] **S8-T04** Clean up. No dead code, no skipped tests, no TODO comments, no secrets, `.env.example` only.
* [ ] **S8-T05** Fresh clone verification. Clone to a new directory, install, run the full suite, run the demo path.
* [ ] **S8-T06** Optional short screen recording of the discovery run, the replay, and one escalation handoff.

---

## Slice 9. Stretch, conditional

Do not start until Slices 0 to 8 are complete and green. The brief says at most one or two, and zero is a defensible answer.

* [ ] **S9-T01** Capability catalog. `GET /capabilities` listing approved capabilities as callable tools using the JSON Schema from S7-T08, and `POST /capabilities/:id/invoke` executing a replay with typed args.
  * Accept: the invoke response uses the caller projection from S3-T07, so an agent asking for a balance receives the balance while the persisted copy stays redacted.
  * Test: integration, a tool definition is generated from the artifact and an invocation returns typed outputs.

---

## Time pressure protocol

If effort has to be capped, cut in this order. The ranking comes from the evaluation weighting in `docs/REQUIREMENTS.md`, not from what is most pleasant to build.

**Never cut.** The live discovery run, S5-T12. The business outcome split, S4-T04 and the `MEMBER_NOT_FOUND` run in S5-T15. A real control transfer on the same session, S6-T07. The write capability, S6-T13, because requirement 3.4 is unproven without an irreversible action that actually runs. The artifact schema, S1-T03 and S1-T04. The desktop stub, S7-T07, which is the cheapest proof of requirement 3.7a in the repository. The generated schema, S7-T08, which is the only thing satisfying requirement 3.2h. `REPORT.md`, S8-T02.

**Cut depth first, in this order.**

1. Slice 9 entirely. It is stretch and the brief says at most one or two, so zero is defensible.
2. Target app faults, down to `denied`, `flaky503`, `surpriseDialog`, `expireSession`, `duplicateIds` and `relabel`. Each removed fault removes a row from the matrix, so remove the ones that duplicate a proven class. `relabel` stays because the drift row depends on it.
3. The second tenant variant, S7-T05, and then the cross tenant demonstration, S7-T06, which cannot survive without it. Both are explicitly cuttable. The brief calls multitenant reuse a design question and marks the demonstration optional, so cutting these downgrades it from demonstrated to designed rather than removing it. The overlay merge S7-T01 stays, because it is unit testable and it is the design being graded. Say all of this in the report.
4. Recovery handlers, down to `TransientLoad` and `KnownInterstitial`. `UnexpectedDialog` keeps escalating, because that one is a safety property and not a feature.
5. Operator console HTML, down to a bare list and three buttons. The API stays fully tested either way.
6. Coverage gates outside `src/core`, `src/replay` and `src/control`.

**Never cut to save time.** Redaction, the allowlist choke point, or the evidence scanner. Note that Slice 3 is where redaction and the evidence sink land, and nothing in Slices 0 to 2 persists anything, so deferring them was an ordering decision and not a cut. If work somehow stops before Slice 3, nothing has been written and there is nothing to leak. If it stops during Slice 3, finish S3-T04 before anything else.

Anything cut goes into `PROGRESS.md` under Deferred and cut with a reason, and then into the Cuts section of `REPORT.md`. The brief rewards a documented cut and penalises a silent gap, and they look identical from outside unless the reason is written down.

---

## Cut list

Format is what, why, and what would be built next.

* **The `visual` locator strategy.** Nothing in the plan ever executed it, and ADR 0009's own argument is that a schema nothing executes is a guess. Next: it is described in `REPORT.md` section 4 as the honest escape hatch for canvas and desktop surfaces.
* **A model invoking the catalog, the old P9-T02.** The brief allows one or two stretch goals and this one depends on a catalog that is itself conditional. Next: the generated tool schema from S7-T08 is the reusable half and it ships unconditionally.
* **Multi run stability scoring, the old P9-T04.** Stability counters moved out of the artifact into the state sidecar, and a flakiness signal over a handful of local runs is noise. Next: S7-T03 records drift, which is the half that carries information.
* **`inputsHash` on the result contract.** An unkeyed hash of a five digit member ID is reversible by enumeration, so it was privacy theatre. Replaced by `inputNames`.
* **The filesystem intervention journal.** A restored intervention points at a browser that died with the process. See ADR 0016. Evidence remains the durable audit trail.

---

## Open items

Genuine unknowns. Each is closed by a named task, and none of them blocks starting.

* **How a ref maps back to a handle.** Closed by S0-T04, recorded as an amendment to ADR 0012.
* **Whether the observation format is enough for a real model on this surface.** Closed by S2-T01. If it is not, the fix lands in S2-T02 before discovery is built.
* **Whether `member.openSubAccount` is hand authored or discovered by a second live run.** Decide at S6-T13. A second live run is the more honest answer and costs one more model budget, and it would exercise the confirm path during discovery rather than only during replay.
* **The deadline.** The instruction that was meant to set it still had its placeholder in it. The forecast is measured against the framing in the brief, a focused effort that should not eat a month, until a real date replaces it.
