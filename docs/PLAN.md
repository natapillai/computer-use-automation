# Implementation plan and master checklist

This is the single source of truth for what is left to build. Tick a box only when the acceptance criteria are met, the named tests exist and pass, and `npm run test` plus `npm run typecheck` are green. Then update `PROGRESS.md`.

Task IDs are stable. Use them in commit messages, for example `S1-T25 implement FakeSurfaceDriver`.

## How this plan is sliced

The brief asks for a complete vertical slice touching every core requirement and warns against a polished subset. An earlier version of this plan was ordered by layer. That put forty four tasks in front of the first working thread and pushed the one genuinely non negotiable requirement, a real live discovery run, to the very end. That order optimises for tidy layers and hides both real risks until late.

The two risks are worth naming, because the slicing exists to expose them early.

* **Schema risk.** A schema nothing has executed is a guess. This is why replay is still built before discovery, against a hand authored fixture artifact. See ADR 0009.
* **Perception risk.** The target app is deliberately built so the accessibility tree alone is not enough. Labels are table cells, so inputs have no accessible name, and layout tables do not reliably expose rows. If the observation format cannot carry that, every type below it changes. See ADR 0012.

So the order is thread first, then a live model against the real surface as early as it can run, then errors, then discovery for real, then escalation, then depth.

* **Slice 0, Foundation.** Tooling, the injected clock, config, redaction, logging, and the thirty minute spike that settles how a ref maps back to a handle.
* **Slice 1, Thread.** A hand authored artifact replays against the running target app and returns a typed money output, with evidence written.
* **Slice 2, Live perception spike.** A throwaway loop with the real model against the real surface. Nothing from it ships.
* **Slice 3, Errors.** Faults, classification, recovery, and the full result matrix.
* **Slice 4, Discovery.** The agent loop, the recorder, the generalizer, the committed live run, and the negative probe review that gives the artifact its business outcomes.
* **Slice 5, Escalation.** Control transfer on the live session, the operator API, the write flow, and the confirm path.
* **Slice 6, Deepen.** Overlays, versioning, drift, the second tenant, the desktop stub, the evidence scanner.
* **Slice 7, Deliverables.** README, REPORT, the traceability walk, a clean clone.
* **Slice 8, Stretch.** Conditional on everything above being green.

Reach each gate before deepening anything behind it.

| Gate | Where | What it proves |
| --- | --- | --- |
| Skeleton 1 | S1-T37 | The production execution path exists end to end against the real app |
| Perception | S2-T01 | A real model can drive this surface from our observation format |
| Skeleton 2 | S4-T12 | The full discovery to replay thread, including a business outcome |
| Skeleton 3 | S5-T15 | A human takes the live session, acts, hands back, and the run completes |

---

## Slice 0. Foundation

* [ ] **S0-T01** Repo skeleton, `package.json`, TypeScript strict, ESM, Node 22, the directory tree from `CLAUDE.md` section 4.
  * Accept: `npm run typecheck` passes on an empty `src`. The tree includes `src/core/surfaceModel`, `profiles/` and `capabilities/`.
* [ ] **S0-T02** Vitest configured with projects for unit, contract, integration and e2e, plus the coverage gates from `docs/TESTING.md` section 7.
  * Accept: `npm run test` runs and reports zero tests without error. Coverage thresholds present. Type level assertions run under `vitest --typecheck`, because Vitest strips types and a type test that is never typechecked proves nothing.
  * Test: one trivial passing test proving the runner works. One setup level guard that fails the suite if a socket is opened to anything other than loopback.
* [ ] **S0-T03** ESLint and Prettier, plus the rule that bans raw timers.
  * Accept: `no-restricted-globals` refuses `setTimeout`, `setInterval` and `setImmediate` inside `src/core`, `src/replay`, `src/discovery` and `src/control`. The only sanctioned delay in the system is `Clock.delay`, which exists for retry backoff and nothing else. A fixture file containing a raw sleep is reported.
* [ ] **S0-T04** `Clock` and `IdProvider`, injected everywhere, with deterministic test implementations.
  * Accept: one `Clock` with `now()` and `delay(ms)` rather than three overlapping abstractions. `delay` is controllable by Vitest fake timers.
  * Test: unit, a seeded provider yields the same IDs and timestamps across runs.
* [ ] **S0-T05** Zod validated environment config and `.env.example`. No secret ever has a default value.
  * Accept: includes `ANTHROPIC_MODEL`, target app credentials and `INTERVENTION_CLAIM_TIMEOUT_MS`. The model ID lives here and in no document, per ADR 0011.
  * Test: unit, a missing required var fails fast with a named message. `.env.example` contains no real values.
* [ ] **S0-T06** GitHub Actions workflow running typecheck, lint, test, test:integration and test:e2e.
  * Accept: installs Chromium, references no secret, and leaves `ANTHROPIC_API_KEY` unset so a live call cannot happen by accident.
* [ ] **S0-T07** `Redactor`, pattern based plus provenance based, with Luhn validation and object traversal.
  * Accept: patterns load from the allowlist with an explicit `flags` field. Inline `(?i)` is a PCRE form that JavaScript rejects when the expression is constructed, so it appears nowhere.
  * Test: unit, every pattern positive and negative, Luhn rejects an invalid number, redaction is idempotent, nested arrays are traversed.
* [ ] **S0-T08** Sensitivity propagation as a pure function.
  * Test: unit, an output from a secret sourced field inherits secret. Public stays public.
* [ ] **S0-T09** Structured JSON lines logger with a pluggable sink, redaction applied at the sink, run scoped correlation IDs.
  * Accept: depends on the real `Redactor` from S0-T07. `docs/TESTING.md` section 3 permits three test doubles and a stub redactor is not one of them, which is why the logger moved behind redaction rather than in front of it.
  * Test: unit, log lines are valid JSON, carry `runId`, and pass through the redactor.
* [ ] **S0-T10** Perception spike, timeboxed to thirty minutes. Settles how a model chosen ref maps back to an actionable handle across a frameset.
  * Accept: a scratch script against a throwaway frameset file answers one question. Does the installed Playwright expose aria-ref locator resolution, as its MCP server uses. If yes, refs map to handles for free and the riskiest task in the project shrinks. If no, the driver uses CDP `Accessibility.getFullAXTree` per frame and resolves `backendDOMNodeId` through `DOM.resolveNode`. The answer is written into ADR 0012 as an amendment before any Slice 1 surface task starts. No production code lands from this task.

---

## Slice 1. Thread

Read `docs/ARTIFACT_SCHEMA.md`, `docs/ARCHITECTURE.md` sections 3 to 7, and `docs/SAFETY.md`.

The goal of the whole slice is gate S1-T37. Everything here is the minimum that gate needs, at full quality. Recovery, classification, overlays and drift are deliberately absent and arrive in later slices.

### Core domain, zero IO

* [ ] **S1-T01** Surface model types in `src/core/surfaceModel`. `UINode`, `Observation`, `Box`, `Relation`, the eleven verb action vocabulary, `ResolvedAction`, `ActionResult`.
  * Accept: `UINode` carries `ref`, `role`, `name`, `derivedLabel`, `value`, `state`, `framePath`, `box`, `children` and an opaque `raw`. `Observation` carries per frame URL and last navigation status, so an `httpStatus` matcher has something to read. No Playwright type appears in `src/core` and no browser concept appears in the vocabulary. `src/surface/types.ts` holds the `SurfaceDriver` interface only and imports these from core, because the dependency direction is inward.
  * Test: unit and type level, the vocabulary is exhaustive and adding a verb without handling it fails to compile.
* [ ] **S1-T02** `LocatorBundle` and `LocatorStrategy` types plus derivation from a `UINode`.
  * Accept: kinds are `role-name`, `test-id`, `label`, `text`, `anchor-relative` and `structural`. There is no `visual` kind, cut by ADR 0013. `matchPolicy` is `unique` or `nth`, and `first` is gone, because taking the first match silently is exactly the behaviour rule 1 in `docs/ARCHITECTURE.md` section 5 forbids. Relations are computed from geometry, not markup. Strategy text fields are `TemplateExpr`.
  * Test: unit, a named node yields `role-name` first. An unnamed input in a table row yields `anchor-relative` from its `derivedLabel`. A generated ID is ranked low. Frame path is captured. A strategy whose text equals a declared input value is emitted as a template, so a member ID never lands in an artifact as a literal.
* [ ] **S1-T03** Record time strategy verification, per ADR 0013.
  * Accept: every derived strategy is resolved against the live observation at derivation time. A strategy that does not uniquely resolve to the recorded element is dropped, not ranked low, so a drift signal later means something.
  * Test: unit, a bundle derived on a page with two matching rows drops the ambiguous `text` strategy and keeps the `anchor-relative` one.
* [ ] **S1-T04** Locator resolution policy as a pure function over a driver supplied `match(strategy)` port.
  * Accept: core owns ordering, ambiguity rejection and degradation recording. A driver only answers which nodes a strategy matches, so the ladder exists once instead of once per driver.
  * Test: unit, the first resolving strategy wins. An ambiguous strategy under `unique` is skipped. All ambiguous yields `LocatorAmbiguous`. A lower ranked win is recorded as drift.
* [ ] **S1-T05** Capability Zod schema, top level shape, types inferred.
  * Accept: `steps[].effect` is read or write and `steps[].idempotent` is a boolean, replacing the single `risk` enum, per ADR 0014. `policy` gains `allowReauth` and loses `allowedOrigins`, because an artifact must not carry an institution host. `lifecycle` loses its `stability` counters, which move to the state sidecar in S1-T16. There is no `extract` step kind. Outputs declare their own bundle and resolve after the step named in `source.stepId`.
  * Test: unit, a valid fixture parses and every module boundary is explicitly typed.
* [ ] **S1-T06** Schema refinements. One test per refinement, each asserting its specific error.
  * Accept, the full list. No retry on a non idempotent step. `redactionApplied` is literal true. Step IDs unique. `index` agrees with array order. Output `source.stepId` references an existing step. `outputResolvable` names a declared output. A step level rule classified `business_outcome` uses a code declared in `outcomes`, so the contract stays closed. Template references name a declared input, an output extracted at an earlier step, or an allowlisted env key. `enumValues` present exactly when the type is enum. `nth` present exactly when `matchPolicy` is `nth`. `approvedBy` and `approvedAt` present when status is approved. Every acting step carries a postcondition, because we never assume a click worked.
  * Accept: `redactionApplied` is documented as a marker and not an enforcement. The enforcement is the writer in S1-T16 scanning before it writes. A literal in a schema cannot know where a value came from, and saying that it can is theatre.
* [ ] **S1-T07** `schemaVersion` compatibility check and a loader that refuses unsupported versions.
  * Test: unit, a future version is refused with `SchemaIncompatible`.
* [ ] **S1-T08** Template resolution over `inputs`, prior `outputs` and allowlisted `env`. No expression language.
  * Test: unit, resolves each scope, an unresolved reference is a hard failure before any action, a literal passes through, escaped braces are handled.
* [ ] **S1-T09** Input validation against `ParamSpec` constraints, running before any surface is opened.
  * Test: unit, pattern, min, max, required, enum. Failure is `InputValidation`.
* [ ] **S1-T10** Result contract types, the `FailureClass` union, and constructors that require `expected` and `observed`.
  * Accept: `ResultBase` carries `inputNames` as a string array rather than `inputsHash`. An unkeyed hash of a five digit member ID is reversible by enumeration, and the only thing a debugger needs is which inputs were supplied. `ResultBase` also carries `interventions[]` next to `recoveries[]`, per ADR 0016, and there is no `resumeToken`.
  * Test: unit, each failure class is constructible. A type level exhaustiveness check run under `vitest --typecheck` fails when a member is added without handling.
* [ ] **S1-T11** `ConditionMatcher` evaluation against an `Observation`, all kinds including `all`, `any` and `not`.
  * Accept: one matcher language, not two. A `Checkpoint` is a description plus a `ConditionMatcher` plus a timeout, so the near duplicate `Assertion` union and its second evaluator both disappear.
  * Test: unit, one per kind, positive and negative.
* [ ] **S1-T12** Money parser handling `$4,250.75`, `4250.75 USD`, `(125.00)` and `$0.00`.
  * Accept: a money value carries an amount in minor units, a currency, and the raw text it came from. That raw text is `pii` and is redacted in every persisted projection.
  * Test: unit, all formats, negative handling, an unparseable string is a typed failure and never a `NaN`.
* [ ] **S1-T13** JSON Schema generation from the capability schema, plus a human readable review sheet.
  * Accept: generated from Zod, so there is one definition and three consumers. This is what makes requirement 3.2h provable from core instead of resting on a stretch task.
  * Test: unit, the generated tool schema for a fixture artifact names every required input with its type, and the review sheet lists every step intent and every declared outcome.
* [ ] **S1-T14** App profile schema, loader, and `profiles/meridian-core.json`.
  * Accept: a profile declares the route plus method table that classifies `effect` and `idempotent`, the field level sensitivity map, and the application wide detectors such as the login redirect and the generic error banner. An action with no entry defaults to write and not idempotent, so it fails closed. Field level sensitivity is what lets us redact a member name, which no regex can find.
  * Test: unit, a profile validates, an unknown route classifies as write, and the sensitivity map marks the member name and the balance cell `pii`.
* [ ] **S1-T15** `PolicyEngine.authorize` with the three valued verdict, allowlist loading and validation, path globbing, and risk classification from the profile.
  * Accept: risk comes from the profile route table and never from a global regex over button text, per ADR 0014. One shot approval grants are bound to run, step and resolved target, and are accepted exactly once. Unknown means deny.
  * Test: unit, the full table from `docs/SAFETY.md` section 6, plus a grant consumed once and refused the second time.
* [ ] **S1-T16** `CapabilityStore`, filesystem implementation. Load, canonical write, index, and the per capability state sidecar.
  * Accept: JSON with stable key order so a diff is reviewable. The writer scans for declared input values and redactor matches before writing and refuses on a hit. `capabilities/<id>/state.json` holds replay counters, drift and `needs_review`, which are operational state and do not belong inside an immutable versioned artifact that git is meant to keep still.
  * Test: unit, a round trip is byte stable, and an artifact carrying a sensitive literal is refused by the writer.
* [ ] **S1-T17** Tenant binding. Schema plus resolution of `baseUrl`, tenant selector and credential reference at invocation time.
  * Test: unit, a capability with no `baseUrl` resolves against a binding, and a missing binding is a typed failure rather than a malformed URL.

### Target application fixture

Read `docs/TARGET_APP.md`. It is a fixture, not the deliverable. Timebox it.

* [ ] **S1-T18** Express plus EJS skeleton, frameset shell with nav, content and status frames, in memory seed data.
  * Accept: generated element IDs are seeded per process from a fixed seed, so an observation hash is stable across runs. ADR 0017 depends on that.
  * Test: integration, each route returns 200 and the frameset contains three frames.
* [ ] **S1-T19** Login, session cookie, redirect for unauthenticated requests.
  * Test: integration, an unauthenticated request to `/servicing` redirects. A valid login sets a cookie.
* [ ] **S1-T20** Member search, results, and the no records banner, rendered in nested tables with no test IDs and generated IDs.
  * Accept: includes the two deliberately hostile controls from `docs/TARGET_APP.md` section 3. The submit is a `<td onclick>` carrying inner text only, with no role and no `title`, because Chromium feeds `title` into the accessible name and a named control would never exercise the fallback. One label reads `Member  ID:` with two spaces. The test asserts what is actually true of the accessible name rather than what we wish were true.
  * Test: integration, a known ID returns a row. `00000` returns the banner.
* [ ] **S1-T21** Member detail with the accounts table and three balance formats across the seed members.
  * Test: integration, balance text matches the documented format per member.
* [ ] **S1-T22** `/__control__/**` mounted only under `TARGET_TEST_MODE=1`, with reset and state.
  * Test: integration, unmounted without the flag, and denied by the allowlist even when it is mounted.

### Surface and control

Read `docs/ARCHITECTURE.md` sections 3 to 5 and `docs/ESCALATION.md` section 2.

* [ ] **S1-T23** `SurfaceDriver` interface and `tests/contract/surfaceDriver.contract.ts`, the full suite from `docs/TESTING.md` section 5.
  * Accept: the suite is a reusable function parameterised over driver factories, not a test file bound to one implementation.
* [ ] **S1-T24** Control state reducer, the seven states and every transition, plus `ControlToken` issuance and rotation.
  * Accept: pure and dependency free, so the contract suite can assert a stale token without waiting for an operator API. That dependency is why this moved ahead of the surface work.
  * Test: unit, every legal transition, every illegal transition throws, table driven over the full matrix. A token held across a transition is rejected afterwards.
* [ ] **S1-T25** `FakeSurfaceDriver`, in memory tree with scripted transitions and injectable conditions.
  * Test: passes the contract suite.
* [ ] **S1-T26** `WebSurfaceDriver`. Playwright, accessibility tree normalisation with geometry and derived labels, frame traversal, ref assignment in document order.
  * Accept: implements the mechanism chosen in S0-T10. Resolution delegates ordering and ambiguity to the core policy from S1-T04 and only answers `match(strategy)`.
  * Test: passes the contract suite against the target app. Frame path is correct for a control inside the content frame. The member ID input resolves through `anchor-relative` even though it has no accessible name, which is the case the whole perception design exists for.
* [ ] **S1-T27** `SessionBroker`. Owns the Playwright context, logs in before the session is handed to any caller, leases sessions by ID, exposes CDP.
  * Accept: authentication is a session concern and never a capability step, so no artifact carries a credential. A `context.route` handler refuses any request to an origin or path outside the allowlist, which is the one control that still applies while a human holds the session.
  * Test: integration, a leased session is already authenticated, and a request to a denied path is refused at the network layer.
* [ ] **S1-T28** `GuardedSurface` wrapper enforcing `PolicyEngine.authorize` and the control token.
  * Accept: `authorize` has exactly one call site. The executor does not call it again, it reads the verdict returned as a typed value, so the choke point is genuinely single.
  * Test: unit, a denied action never reaches the driver. A stale token throws `ControlLostError`. An import graph test proves `discovery` and `replay` cannot reach the raw driver.
* [ ] **S1-T29** `EvidenceSink` writing structured logs, screenshots, snapshots and the run manifest to `evidence/<phase>/<runId>/`.
  * Accept: screenshot masking uses Playwright's own mask option, so unmasked bytes never exist in the process. Masks come from the profile sensitivity map. Two projections exist and are named. The caller projection carries real output values, the persisted projection is redacted. Without that split the catalog would return `[redacted]` to the agent that asked for a balance.
  * Test: unit, the manifest lists every artefact and redaction is applied to all of them. Integration, a masked region is absent from the stored image, sampled by pixel.

### Replay

* [ ] **S1-T30** A hand authored fixture artifact for `member.readSavingsBalance` at `tests/fixtures/capabilities/`.
  * Accept: validates against the schema. `app.entryPath` is `/servicing`, the frameset shell, and every `navigate` declares its `framePath`. Pointing the top level document at a content frame URL destroys the frameset and makes every later `framePath` unresolvable, which is what the original worked example did.
  * Accept: this is a test fixture and never the evidence artifact. ADR 0018 says where the real one comes from.
* [ ] **S1-T31** `ReplayExecutor` step state machine. Resolve, wait, authorize, act, checkpoint, advance.
  * Test: unit against `FakeSurfaceDriver`, the happy path returns success with typed outputs.
* [ ] **S1-T32** Condition based `waitFor` with bounded timeouts and the condition description in the timeout message.
  * Test: unit, resolves on the condition, and times out with the description present in the error.
* [ ] **S1-T33** Checkpoint evaluation, `all` and `any` modes, every matcher kind.
  * Test: unit, one per kind, plus a checkpoint failure producing `CheckpointFailed` carrying expected and observed.
* [ ] **S1-T34** Output extraction and typing, with `OutputUnresolvable` on a missing required output.
  * Accept: outputs resolve after the step named in `source.stepId`, using their own bundle through the same resolution policy as any action target. Reading a balance is exactly as failure prone as clicking a button.
  * Test: unit and integration, money parsed to a typed value, and a missing required output is a hard failure rather than a silent undefined.
* [ ] **S1-T35** `ReplayResult` assembly including `inputNames`, `drift` and the evidence bundle.
  * Test: unit, a successful run reports its drift records and an empty recoveries array rather than omitting the field.
* [ ] **S1-T36** `npm run replay` CLI taking a capability ID, a version, a variant, a tenant binding and inputs.
  * Accept: inputs arrive on stdin or from a file and never as argv, because a member ID in a shell history is a small leak that costs nothing to avoid.
  * Test: e2e, the CLI exits 0 on success and non zero on failure, and the printed result is valid JSON.
* [ ] **S1-T37** **Gate, Skeleton 1.** The fixture artifact replays against the live target app and returns a typed money output.
  * Test: integration, `member.readSavingsBalance` for member `10001` returns `success` with `savingsBalance` of 425075 minor units in USD, and writes an evidence directory with a valid manifest.

---

## Slice 2. Live perception spike

The one thing that cannot be answered by design review. Do not skip it and do not polish it.

* [ ] **S2-T01** **Gate, Perception.** A throwaway loop in `scripts/spike/`, real model, real target app, refs only tool surface, no policy, no recorder, no artifact.
  * Accept: the question is whether a real model reaches the savings balance for member `10001` from our observation format, in under twenty steps. The transcript goes to the scratchpad, not to `evidence/`, because this is not the deliverable run.
  * Accept: findings land in `PROGRESS.md` and, if the observation format has to change, as an amendment to ADR 0012 plus a task in this slice. The script stays under `scripts/spike/` with a header saying it is not production code, or it is deleted.
* [ ] **S2-T02** Fold the spike findings back into `src/core/surfaceModel` and the observation builder contract. Conditional. If the spike showed nothing needs changing, tick this with a note saying so, which is itself a result worth recording.

---

## Slice 3. Errors

Read `docs/ERROR_TAXONOMY.md` in full.

* [ ] **S3-T01** All eleven faults from `docs/TARGET_APP.md` section 5.
  * Accept: every fault is route scoped and deterministic. `flaky503` names the route it fails and the number of times, rather than failing an unspecified first request. `slow` takes a fixed configurable delay instead of a random three to six seconds, because a random delay is a flaky test generator and the fixture is supposed to be hermetic. `surpriseDialog` renders an HTML modal, not a native dialog. Playwright auto dismisses native dialogs when no handler is registered, which is precisely the click through this system must never perform, and a native dialog is invisible to a screenshot and unreachable by forwarded CDP input, so it would also break the operator handoff.
  * Accept: a native dialog handler is registered anyway, and it neither accepts nor dismisses. It captures and escalates.
  * Test: integration, one per fault asserting the documented behaviour. This suite protects every downstream error test.
* [ ] **S3-T02** Outcome classifier with a single total precedence order.
  * Accept: step detectors, then capability outcomes, then app profile. Within a tie, business outcome beats failure. Nothing else. The previous wording had two precedence rules that disagreed whenever a step level failure met a capability level outcome.
  * Accept: the failure case is postcondition failed and no detector matched, not an abstract unmatched condition. An unclassifiable state returns `Internal`, never a guess.
  * Test: unit, table driven over the precedence matrix including the case where the two old rules conflicted.
* [ ] **S3-T03** The classification race in `waitFor`.
  * Accept: after acting, the executor waits on `any(postcondition, capability outcome detectors, profile detectors)` and classifies whichever fired. Waiting on the postcondition alone means every business outcome costs a full timeout and then reports as `Timeout` or `CheckpointFailed`, which is the brief's most penalised mistake arriving through the back door.
  * Test: integration, a search for `00000` classifies `MEMBER_NOT_FOUND` in well under the step timeout, asserted against the fake clock and against the real app.
* [ ] **S3-T04** Retry policy, bounded, exponential backoff through `Clock.delay`, only on idempotent steps.
  * Accept: retry is gated on `idempotent`, not on `effect`. A search POST is a read that is not idempotent, so it is not retried, and a fill is retried, per ADR 0014.
  * Test: unit with fake timers, backoff timing, and a non idempotent step is never retried.
* [ ] **S3-T05** Recovery handlers for `TransientLoad`, `KnownInterstitial`, `StaleElement` and `SessionExpired`, each bounded and each recorded in `recoveries`.
  * Accept: `SessionExpired` re authenticates through the session broker, then restarts the capability from step zero if and only if every completed step was a read. After a re login the browser is at the landing page, so resuming from the current step's precondition cannot work, and replaying a completed write would be a double post.
  * Test: unit for the bounds, integration for each against its fault.
* [ ] **S3-T06** `UnexpectedDialog` escalates and never auto dismisses.
  * Test: integration against `surpriseDialog`, asserting no click was dispatched and a screenshot was captured.
* [ ] **S3-T07** Budgets and the rate limit.
  * Accept: max steps, max duration and `maxActionsPerMinute`. The rate limit throttles through `Clock.delay` rather than failing the run, because rate limiting a legacy app is politeness, not an error condition. Budget exhaustion is a failure and is not an escalation, per `docs/ESCALATION.md` section 3.
  * Test: unit with fake timers, each budget terminates the run, and the throttle delays rather than denying.
* [ ] **S3-T08** Import graph test proving `src/replay` contains no model client.
  * Test: unit, walks the resolved import graph.
* [ ] **S3-T09** The full integration matrix from `docs/ERROR_TAXONOMY.md` section 8.
  * Accept: the locator drift row uses the `relabel` fault rather than the second tenant, so the matrix does not depend on a task that the time pressure protocol lists as cuttable.
  * Test: integration, one per row, each asserting the exact status and code.

---

## Slice 4. Discovery

Read `docs/ARCHITECTURE.md` section 6 and ADRs 0013, 0017 and 0018.

* [ ] **S4-T01** `ModelClient` interface plus `FakeModelClient` and `CassetteModelClient`.
  * Accept: cassette matching is positional with a shape assertion, per ADR 0017. The client returns exchange N for the Nth call and asserts the tool set and the observation hash match what was recorded.
  * Test: unit, the cassette replays deterministically, and a changed observation hash fails with a diff rather than replaying the wrong turn.
* [ ] **S4-T02** Observation builder. Prune to interactive and text bearing nodes, assign refs in document order, attach derived labels, apply redaction before the prompt is built.
  * Accept: refs are assigned in document order so the observation hash is stable, which the cassette depends on. Redaction uses the profile sensitivity map, so a member name is masked even though no regex would find it.
  * Test: unit, a large tree prunes below the token budget, and a fixture observation contains no unredacted PII.
* [ ] **S4-T03** Prompt construction and the tool schema, versioned by `promptVersion`.
  * Accept: the model's tools are refs only. `click`, `fill` with an input name, `select`, `press`, `navigate`, `extract` with an output name and type, `escalate`, `done`. The model is never given `waitFor` or `assert`, because both take locators and conditions, and a model that authors either has authored a locator. Waits and checkpoints are inferred by the generalizer. This is ADR 0013 and it is why the tool set deliberately does not mirror the driver vocabulary.
  * Test: unit, the tool definitions are asserted programmatically against the allowed subset, so the two cannot drift together by accident.
* [ ] **S4-T04** `AgentLoop`. Observe, decide, authorize, act, record, with all stopping conditions.
  * Test: unit with `FakeModelClient`, stops on done, on max steps, on max duration, on no progress. A denied action never reaches the driver. A bad ref produces a corrective observation rather than a crash.
* [ ] **S4-T05** `Recorder` deriving a `LocatorBundle` from the real element at action time, never from model output, using S1-T02 and S1-T03.
  * Test: unit, the recorded bundle contains only verified strategies, and a test asserts the model's text output is never used as a selector.
* [ ] **S4-T06** `RunTrace` persistence, the full raw record, separate from the artifact.
  * Accept: each acted element's redacted neighbourhood is stored, so re deriving locators from a trace is a real capability rather than a claim. ADR 0004 claimed it while the capture policy made it impossible.
  * Test: unit, a trace round trips and contains observation hashes and authorization decisions.
* [ ] **S4-T07** `Generalizer`, the six transforms, as a pure function.
  * Accept: discovery success is not circular. The model calls `done`, the generalizer synthesizes a success condition from the final observation, and that condition is then re asserted against that same observation. If it does not hold, the run did not succeed. That also catches a model declaring victory on the wrong screen.
  * Test: unit, one per transform. A fixture trace snapshot compares against an expected artifact. A sensitive literal is never emitted, asserted by scanning the JSON.
* [ ] **S4-T08** `npm run discover` CLI taking a goal, a target, a tenant binding and an input schema, writing the artifact plus evidence.
  * Accept: discovery returns a typed `DiscoveryResult` of produced, escalated or failed, carrying the same evidence bundle shape a replay returns. The loop had stopping conditions and no result contract, so nothing could report why a run stopped.
  * Accept: the goal is templated. `look up member {{inputs.memberId}}` with values supplied separately, so the goal string itself never carries PII into the prompt or the evidence.
* [ ] **S4-T09** The real live discovery run against the target app with a real key. Commit the evidence directory.
  * Accept: `evidence/discovery/<runId>/` contains the transcript, the trace, screenshots and the produced artifact at version `1.0.0`, status draft. This satisfies the brief's one non negotiable requirement.
* [ ] **S4-T10** Negative probe review, per ADR 0018. `npm run review` replays the draft with a probe input, stops where the postcondition fails, and lets a reviewer name the outcome while the recorder derives the detector from the real element.
  * Accept: emits `1.1.0` with `MEMBER_NOT_FOUND` declared, `provenance: 'manual'` on the added outcome, and the probe run committed to evidence. This is how a discovered artifact acquires business outcomes without anyone hand writing a selector.
  * Test: integration, the probe run against `00000` produces a detector bundle that resolves on the banner, and the version bump classifies as minor.
  * Accept: the same command approves a reviewed capability, writing `status`, `approvedBy` and `approvedAt`. Approval is a commit, so who approved what is answerable from git history rather than from a database nobody kept.
* [ ] **S4-T11** Record the cassette from the live run and wire it into the E2E test.
  * Test: e2e, the full thread runs offline with no network and no key.
* [ ] **S4-T12** **Gate, Skeleton 2.** Replay the reviewed `1.1.0` artifact twice and commit both runs.
  * Accept: `evidence/replay/success/` for member `10001`, and `evidence/replay/businessOutcome/` for `00000` returning `business_outcome` with `MEMBER_NOT_FOUND` and no failure. The artifact replayed here is the discovered one, not the S1-T30 fixture, so the thread from goal to outcome is continuous.

---

## Slice 5. Escalation and operator handoff

Read `docs/ESCALATION.md` in full, and ADRs 0014 and 0016.

* [ ] **S5-T01** The six stuck detectors, each independently testable.
  * Test: unit, each fires on its condition and stays silent otherwise. `NoProgress` uses the accessibility hash, proven by a test where only a timestamp on the page changed.
* [ ] **S5-T02** `InterventionRequest` construction with every required field, redacted.
  * Accept: no `resumeToken`, per ADR 0016.
  * Test: unit, all fields present, and the payload contains no unredacted PII.
* [ ] **S5-T03** `InterventionStore` interface plus an in memory implementation.
  * Accept: no filesystem journal. A restored intervention would point at a browser that died with the process, so the journal was audit theatre. Evidence is the durable record.
  * Test: unit, open interventions are listed and a claim is recorded.
* [ ] **S5-T04** Operator HTTP and WebSocket API, hosted by the run process, all eight endpoints from `docs/ESCALATION.md` section 5.
  * Accept: the run blocks in `pending_human` and prints the intervention URL to stdout, so the handoff is demonstrable from the terminal instead of merely present in the code. `POST /sessions/:id/input` requires the current human token, because that path never passes through `act()` and so does not inherit its fencing.
  * Test: integration, each endpoint. Claim transfers control. Release returns it. An input request with a stale token is refused.
* [ ] **S5-T05** Screenshot streaming over WebSocket, throttled and masked.
  * Test: integration, frames arrive, masking is applied, and the stream stops on release.
* [ ] **S5-T06** CDP input forwarding, mouse and keyboard, into the same live page.
  * Accept: before dispatching, the forwarder hit tests the coordinate with `DOM.getNodeForLocation` and runs the normal recorder on the result, so a human action produces a real `LocatorBundle` rather than a role and a name. A role and a name cannot be replayed, which would have made the draft steps in S5-T09 useless. It also works across frames without instrumenting the page.
  * Test: integration, a forwarded click changes page state, proving it is the same session, and produces a bundle that resolves.
* [ ] **S5-T07** Human action recording.
  * Accept: typed values are never captured, not even redacted with a length. The value is not needed. A human filled field becomes an input template on the draft step.
  * Test: integration, a forwarded click and a fill both appear as `HumanActionRecord` with a derived target, and no value is present anywhere in the record.
* [ ] **S5-T08** Resume revalidation, all branches from `docs/ESCALATION.md` section 7.
  * Test: unit, one per branch. Specifically, when the human completed the whole task the run reports success without re acting.
* [ ] **S5-T09** Human actions converted to draft steps with `provenance: 'human'`, requiring approval.
  * Test: unit, draft steps appear on a new revision and the approved artifact is unchanged.
* [ ] **S5-T10** `MockOperator` test client driving the real API, plus the bare operator HTML page.
  * Test: integration, a full claim, act, release cycle completes headlessly and the run finishes.
* [ ] **S5-T11** Policy `confirm` verdicts routed through the same intervention channel, resolved by a one shot approval grant.
  * Accept: release carries an approval grant bound to run, step and resolved target. Without it the resumed step re authorizes, is told to confirm again, and escalates forever. That loop is the reason ADR 0014 exists.
  * Test: integration, a write step raises an intervention, proceeds once after approval, and a second attempt on the same step raises again rather than reusing the grant.
* [ ] **S5-T12** The write flow in the target app. Sub account form, field level validation, confirmation screen, and the `validation` fault.
  * Test: integration, a valid post reaches confirmation and an invalid post returns a field error.
* [ ] **S5-T13** `member.openSubAccount`, the write capability. Requirement 3.4 is unproven without it.
  * Accept: covers what the read flow cannot. A `write` step confirms during a draft replay and runs unattended once the capability is approved and declares `allowUnattendedReplay`. The submit is not idempotent, so a 503 on it is never retried and recovery re evaluates the postcondition instead, which is the double post safety story. A field level validation error is a declared business outcome with its message captured as structured data.
  * Test: integration, four cases. Confirm then proceed. Approved and unattended. `flaky503` on the submit recovers without a second post. `validation` returns `business_outcome` with the field message.
  * Accept: defines attended. A draft replay is attended, meaning the operator API is reachable and a confirm can be answered by a person. An approved capability declaring `allowUnattendedReplay` runs with nobody there, and a confirm in that state is a failure rather than a silent wait.
* [ ] **S5-T14** `npm run serve` starting the operator console with no run attached, for the catalog and for reading past interventions.
  * Test: integration, the server starts and serves the console page.
* [ ] **S5-T15** **Gate, Skeleton 3.** Commit an escalating replay to `evidence/replay/escalated/`, using `surpriseDialog`, including the intervention payload and the handoff log.
  * Accept: the committed run shows the full cycle. Escalate, claim, human acts on the live session, release, resume, and a final result carrying the intervention in `interventions[]`.

---

## Slice 6. Deepen

* [ ] **S6-T01** Overlay schema and typed merge, per ADR 0015.
  * Accept: an overlay may override bindings. `steps[].target`, `steps[].value`, `outputs[].source`, `outcomes[].detect`, `app.baseUrl`, and it may add `onCondition` rules and mark a step optional. It may not change a contract. Output name, type, sensitivity or required, the input specs, the step ids or the step order. Every overlay declares `appliesTo`, a semver range over base versions, and may declare `extends`.
  * Test: unit, a locator override applies, an output binding override applies, an attempt to change an output type is rejected, and an overlay outside its `appliesTo` range refuses to load.
* [ ] **S6-T02** Version bump rules, classifying a diff between two artifacts as patch, minor or major.
  * Test: unit, fixture pairs for each class, including the S4-T10 review producing a minor bump.
* [ ] **S6-T03** `surfaceFingerprint` capture and comparison, drift records, and the state sidecar.
  * Accept: the recorder computes the fingerprint as a hash of the accessibility skeleton with text excluded. On replay a mismatch does not fail the run, it increments drift in `capabilities/<id>/state.json` and marks the variant `needs_review`, which is a sidecar state and not an artifact status.
  * Test: unit, a mismatch produces a drift record and flips the sidecar flag without touching the artifact file.
* [ ] **S6-T04** Tenant variants `acme` and `borealis`, selected by `Host` or `?tenant=`.
  * Accept: both origins are in the allowlist, so tenant selection does not require a policy exception.
  * Test: integration, `borealis` renders `Member Number`, includes the branch dropdown, moves the balance column, and shows the post login interstitial.
* [ ] **S6-T05** Cross tenant reuse. Replay the `acme` artifact against `borealis`, failing first, then passing with a sparse overlay. Commit both runs.
  * Accept: the overlay overrides the member ID locator and the balance output binding. The second of those is the one ADR 0007 forbade and ADR 0015 permits, and it is the most common real tenant difference.
  * Test: integration, without the overlay it fails with `LocatorNotFound` listing every attempted strategy, and with the overlay it succeeds.
* [ ] **S6-T06** `DesktopSurfaceDriver` stub implementing the interface, throwing `NotImplementedError`, with the verb to UI Automation mapping table in its doc comment.
  * Accept: the mapping includes how geometry based relations map to UI Automation bounding rectangles, which is what makes the seam credible rather than decorative.
  * Test: unit, the class satisfies the interface type and every verb throws with a named message.
* [ ] **S6-T07** The evidence scanner, permanent, part of the suite.
  * Accept: it scans `evidence/`, `capabilities/` and `tests/fixtures/cassettes/`. The cassette is a committed model transcript and was previously unscanned. It searches for seeded canary literals, the seed member names, the seed balances, the member IDs and a Luhn valid card number planted in the fixture, as well as the redaction patterns. Scanning with only the redactor's own patterns can only find what the redactor would already have caught, which makes the test close to a tautology.
  * Test: unit, the scanner fails on a planted canary and passes on the committed tree.
* [ ] **S6-T08** `evidence/README.md`, written for a reviewer with limited time. One or two sentences per directory, naming the single most interesting file in each.

---

## Slice 7. Deliverables

* [ ] **S7-T01** `README.md`. Setup, config, the exact demo command sequence, how to run without live services, and a clear statement that `apps/target` is a fixture and that the Express and Fastify split is deliberate.
  * Accept: a reader following it from a clean clone reaches a successful replay. Verify literally, on a clean clone.
* [ ] **S7-T02** `REPORT.md`, one to three pages, first person.
  * Accept: the seven headings use the brief's exact wording, ampersands and hyphen included. Architecture, Artifact schema, Determinism & error handling, Heterogeneity & multi-tenant, Escalation & handoff, Safety, Cuts. The repository style rules do not override a graded instruction, and the brief says these paths and headings are exact.
* [ ] **S7-T03** Walk `docs/REQUIREMENTS.md` end to end. Every row has a ticked task and a named passing test, or an entry in Cuts.
* [ ] **S7-T04** Clean up. No dead code, no skipped tests, no TODO comments, no secrets, `.env.example` only.
* [ ] **S7-T05** Fresh clone verification. Clone to a new directory, install, run the full suite, run the demo path.
* [ ] **S7-T06** Optional short screen recording of the discovery run, the replay, and one escalation handoff.

---

## Slice 8. Stretch, conditional

Do not start until Slices 0 to 7 are complete and green. The brief says pick at most one or two, and the honest answer may be zero.

* [ ] **S8-T01** Capability catalog. `GET /capabilities` listing approved capabilities as callable tools using the JSON Schema already generated in S1-T13, and `POST /capabilities/:id/invoke` executing a replay with typed args.
  * Accept: the invoke response uses the caller projection from S1-T29, so an agent asking for a balance receives the balance while the persisted copy stays redacted.
  * Test: integration, a tool definition is generated from the artifact and an invocation returns typed outputs.

---

## Time pressure protocol

If effort has to be capped, cut in this order. The ranking comes from the evaluation weighting in `docs/REQUIREMENTS.md`, not from what is most pleasant to build.

**Never cut.** The live discovery run, S4-T09. The business outcome split, S3-T02 and the `MEMBER_NOT_FOUND` run in S4-T12. A real control transfer on the same session, S5-T06. The write capability, S5-T13, because requirement 3.4 is unproven without an irreversible action that actually runs. The artifact schema, S1-T05 and S1-T06. `REPORT.md`, S7-T02.

**Cut depth first, in this order.**

1. Slice 8 entirely. It is stretch and the brief says at most one or two, so zero is a defensible answer.
2. Target app faults, down to a minimum of `denied`, `flaky503`, `surpriseDialog`, `expireSession`, `duplicateIds` and `relabel`. Each removed fault removes a row from the matrix, so remove the ones that duplicate a proven class. `relabel` stays because the drift row now depends on it.
3. The second tenant, S6-T04 and S6-T05, which downgrades multitenant from demonstrated to designed. The overlay merge in S6-T01 stays, because it is unit testable and it is the design being graded. Say so in the report.
4. Recovery handlers, down to `TransientLoad` and `KnownInterstitial`. `UnexpectedDialog` keeps escalating, because that one is a safety property and not a feature.
5. Operator console HTML, down to a bare list and three buttons. The API stays fully tested either way.
6. Coverage gates outside `src/core`, `src/replay` and `src/control`.

**Never cut to save time.** Redaction, the allowlist choke point, or the evidence scanner. A submission that leaks data in a public repository fails on a criterion the brief lists explicitly, and the whole point of this system is that it operates on regulated data.

Anything cut goes into `PROGRESS.md` under Deferred and cut with a reason, and then into the Cuts section of `REPORT.md`. The brief rewards a documented cut and penalises a silent gap. They look identical from the outside unless the reason is written down.

---

## Cut list

Format is what, why, and what would be built next.

* **The `visual` locator strategy.** Nothing in the plan ever executed it, and ADR 0009's own argument is that a schema nothing executes is a guess. Next: it is the honest escape hatch for canvas and desktop surfaces, and it is described in `REPORT.md` section 4 rather than half built.
* **A model invoking the catalog, the old P9-T02.** The brief allows one or two stretch goals and this one depends on a catalog that is itself conditional. Next: the generated tool schema from S1-T13 is the reusable half and it ships in core.
* **Multi run stability scoring, the old P9-T04.** Stability counters moved out of the artifact into the state sidecar, and a flakiness signal over a handful of local runs is noise. Next: S6-T03 records drift, which is the half that carries information.
* **`inputsHash` on the result contract.** An unkeyed hash of a five digit member ID is reversible by enumeration, so it was privacy theatre. Replaced by `inputNames`.
* **The filesystem intervention journal.** A restored intervention points at a browser that died with the process. See ADR 0016. Evidence remains the durable audit trail.

---

## Open items

Genuine unknowns. Each is closed by a named task, and none of them blocks starting.

* **How a ref maps back to a handle.** Closed by S0-T10, recorded as an amendment to ADR 0012.
* **Whether the observation format is enough for a real model on this surface.** Closed by S2-T01. If it is not, the fix lands in S2-T02 before discovery is built.
* **Whether `member.openSubAccount` is hand authored or discovered by a second live run.** Decide at S5-T13. A second live run is the more honest answer and costs one more model budget, and it would also exercise the confirm path during discovery rather than only during replay.
