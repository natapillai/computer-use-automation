# Implementation plan and master checklist

This is the single source of truth for what is left to build. Tick a box only when the acceptance criteria are met, the named tests exist and pass, and `npm run test` plus `npm run typecheck` are green. Then update `PROGRESS.md`.

Task IDs are stable. Use them in commit messages, for example `P3-T02 implement FakeSurfaceDriver`.

## Sequencing rationale

Replay is built before discovery. That looks backwards and it is deliberate.

The artifact schema is the centre of the evaluation, and the schema is only proven correct by something consuming it. If we build the executor first against a hand authored fixture artifact, we learn what the schema actually needs before a model driven pipeline is generating them. Discovery then has a concrete, tested target to produce rather than a guess. Building discovery first means writing a generalizer that emits a schema nothing has ever executed.

The local target app comes second, before any automation, because everything downstream needs something to drive and the whole test suite depends on it.

---

## Phase 0. Foundation

* [ ] **P0-T01** Repo skeleton, `package.json`, TypeScript strict, ESM, Node 20, the directory tree from `CLAUDE.md` section 4.
  * Accept: `npm run typecheck` passes on an empty `src`. `.gitignore` covers `.env`, `node_modules`, `evidence/tmp`, screenshots outside committed runs.
* [ ] **P0-T02** Vitest configured with projects for unit, contract, integration, e2e, and the coverage gates from `docs/TESTING.md` section 7.
  * Accept: `npm run test` runs and reports zero tests without error. Coverage thresholds are present in config.
  * Test: one trivial passing test proving the runner works.
* [ ] **P0-T03** ESLint and Prettier, plus the custom rule forbidding a bare timer used as a delay in `src/replay` and `src/core`.
  * Accept: `npm run lint` passes. A fixture file containing `setTimeout(r, 500)` as a sleep is reported.
* [ ] **P0-T04** `TimeProvider`, `IdProvider`, and `Clock` injected everywhere, with deterministic test implementations.
  * Test: unit, seeded provider yields the same IDs and timestamps across runs.
* [ ] **P0-T05** Zod validated environment config and `.env.example`. No secret ever has a default value.
  * Test: unit, missing required var fails fast with a named message. `.env.example` contains no real values.
* [ ] **P0-T06** GitHub Actions workflow running typecheck, lint, test, test:integration, test:e2e.
  * Accept: the workflow file exists and does not reference any secret.
* [ ] **P0-T07** Structured JSON lines logger with a pluggable sink, redaction applied at the sink, run scoped correlation IDs.
  * Test: unit, log lines are valid JSON, carry `runId`, and pass through the redactor.

## Phase 1. Core domain, zero IO

Read `docs/ARTIFACT_SCHEMA.md`, `docs/ERROR_TAXONOMY.md`, and `docs/SAFETY.md` before starting.

* [ ] **P1-T01** Capability Zod schema, complete, with types inferred. Refinements included, meaning no retry on irreversible steps, `redactionApplied` literal true, step IDs unique, output `source.stepId` references an existing step.
  * Test: unit, valid fixture parses. One test per refinement, each asserting the specific error.
* [ ] **P1-T02** `schemaVersion` compatibility check and a loader that refuses unsupported versions.
  * Test: unit, future version refused with `SchemaIncompatible`.
* [ ] **P1-T03** Template resolution over `inputs`, `outputs`, and allowlisted `env`. No expression language.
  * Test: unit, resolves each scope, unresolved reference is a hard failure, a literal with no template passes through, escaped braces are handled.
* [ ] **P1-T04** Input validation against `ParamSpec` constraints, running before any surface is opened.
  * Test: unit, pattern, min, max, required, enum. Failure is `InputValidation`.
* [ ] **P1-T05** `LocatorBundle` and `LocatorStrategy` types, plus derivation from a `UINode` producing an ordered bundle.
  * Test: unit, a node with role and name yields `role-name` first. A node inside a table row yields an `anchor-relative` candidate. A generated ID is ranked low. Frame path is captured.
* [ ] **P1-T06** Locator resolution policy as a pure function over a candidate node list, covering ordering, ambiguity rejection, degradation recording.
  * Test: unit, first resolving strategy wins. Ambiguous under `unique` is skipped. All ambiguous yields `LocatorAmbiguous`. A lower ranked win is recorded as drift.
* [ ] **P1-T07** Result contract types, `FailureClass` union, and constructors that require `expected` and `observed`.
  * Test: unit, each failure class constructible. The exhaustiveness check fails to compile if a member is added without handling.
* [ ] **P1-T08** `ConditionMatcher` evaluation against an `Observation`, all matcher kinds including `all` and `any`.
  * Test: unit, one per kind, positive and negative.
* [ ] **P1-T09** Outcome classifier with three layer precedence, step over capability over app profile, business outcome over failure.
  * Test: unit, precedence table driven. Unmatched condition yields a failure, never a silent pass.
* [ ] **P1-T10** `PolicyEngine.authorize` with the three valued verdict, allowlist loading, path globbing, risk classification.
  * Test: unit, the full table from `docs/SAFETY.md` section 6.
* [ ] **P1-T11** `Redactor`, pattern based plus provenance based, with Luhn validation and object traversal.
  * Test: unit, every pattern positive and negative, Luhn rejects an invalid number, idempotent, nested arrays traversed.
* [ ] **P1-T12** Sensitivity propagation as a pure function.
  * Test: unit, an output from a secret sourced field inherits secret. Public stays public.
* [ ] **P1-T13** Money parser handling `$4,250.75`, `4250.75 USD`, and `(125.00)`.
  * Test: unit, all three formats, negative handling, an unparseable string is a typed failure not a `NaN`.
* [ ] **P1-T14** Capability overlay merge, base then vendor variant then tenant variant.
  * Test: unit, locator override applies. Base structure is preserved. An overlay attempting to change `inputs` or `outputs` is rejected.
* [ ] **P1-T15** Version bump rules, classifying a diff between two artifacts as patch, minor, or major.
  * Test: unit, fixture pairs for each class.

## Phase 2. Target application fixture

Read `docs/TARGET_APP.md`.

* [ ] **P2-T01** Express plus EJS skeleton, frameset shell, nav, content, and status frames, in memory seed data.
  * Test: integration, each route returns 200 and the frameset contains three frames.
* [ ] **P2-T02** Login, session cookie, redirect for unauthenticated requests.
  * Test: integration, unauthenticated request to `/servicing` redirects. Valid login sets a cookie.
* [ ] **P2-T03** Member search, results, and the no records banner, rendered in nested tables with no test IDs and generated IDs.
  * Test: integration, known ID returns a row. `00000` returns the banner.
* [ ] **P2-T04** Member detail with the accounts table and three balance formats across the seed members.
  * Test: integration, balance text matches the documented format per member.
* [ ] **P2-T05** Sub account form and confirmation screen, with field level validation.
  * Test: integration, valid post reaches confirmation. Invalid post returns a field error.
* [ ] **P2-T06** The non semantic `<td onclick>` control, and the two spaced label, deliberate hostility.
  * Test: integration, the control has no role and no accessible name, asserted to keep it hostile.
* [ ] **P2-T07** `/__control__/**` mounted only under `TARGET_TEST_MODE=1`, with reset, fault, and state.
  * Test: integration, unmounted without the flag.
* [ ] **P2-T08** All eleven faults from `docs/TARGET_APP.md` section 5.
  * Test: integration, one per fault asserting the documented behaviour. This suite protects every downstream error test.
* [ ] **P2-T09** Tenant variants `acme` and `borealis`, selected by `Host` or `?tenant=`.
  * Test: integration, `borealis` renders `Member Number`, includes the branch dropdown, and moves the balance column.

## Phase 3. Surface layer

Read `docs/ARCHITECTURE.md` sections 3 to 5.

* [ ] **P3-T01** `SurfaceDriver` interface, `Observation`, `UINode`, `ResolvedAction`, `ActionResult`, and the eleven verb action union.
  * Accept: no browser type appears anywhere in `src/surface/types.ts`.
* [ ] **P3-T02** `tests/contract/surfaceDriver.contract.ts`, the full suite from `docs/TESTING.md` section 5.
  * Accept: it is a reusable function, not a test file bound to one implementation.
* [ ] **P3-T03** `FakeSurfaceDriver`, in memory tree with scripted transitions and injectable conditions.
  * Test: passes the contract suite.
* [ ] **P3-T04** `WebSurfaceDriver`, Playwright, accessibility tree normalisation, frame traversal, ref assignment per snapshot.
  * Test: passes the contract suite against the target app. Frame path is correct for a control inside the content frame.
* [ ] **P3-T05** Locator resolution in the web driver, executing the strategy ladder including `anchor-relative` over table rows.
  * Test: integration, resolves the member ID input by each strategy independently. `relabel` fault breaks `role-name` and `anchor-relative` recovers.
* [ ] **P3-T06** Screenshot and accessibility snapshot capture, with masking applied before bytes are written.
  * Test: integration, a masked region is not present in the stored image, sampled by pixel.
* [ ] **P3-T07** `GuardedSurface` wrapper enforcing `PolicyEngine.authorize` and the control token.
  * Test: unit, denied action never reaches the driver. Stale token throws `ControlLostError`. Import graph test proves `discovery` and `replay` cannot reach the raw driver.
* [ ] **P3-T08** `DesktopSurfaceDriver` stub implementing the interface, throwing `NotImplementedError`, with the verb to UI Automation mapping table in its doc comment.
  * Test: unit, the class satisfies the interface type. Every verb throws with a named message.

## Phase 4. Control plane

Read `docs/ESCALATION.md` sections 2 and 7.

* [ ] **P4-T01** Control state reducer, the seven states and every transition, as a pure function.
  * Test: unit, every legal transition. Every illegal transition throws. Table driven over the full matrix.
* [ ] **P4-T02** `ControlToken` issuance and rotation on every transition.
  * Test: unit, a token held across a transition is rejected afterwards.
* [ ] **P4-T03** `SessionBroker` owning Playwright contexts, leasing sessions by ID, exposing CDP.
  * Test: integration, a session survives a control transfer and retains cookies and frame state.
* [ ] **P4-T04** Claim timeout releasing an unclaimed `pending_human` session.
  * Test: unit with fake timers, the session terminates as `escalated` with `unclaimed`.
* [ ] **P4-T05** Concurrent claim safety.
  * Test: unit, two simultaneous claims, exactly one succeeds.

## Phase 5. Deterministic replay

Read `docs/ERROR_TAXONOMY.md` in full.

* [ ] **P5-T01** A hand authored fixture artifact for `member.readSavingsBalance` at `tests/fixtures/capabilities/`.
  * Accept: it validates against the schema. This is the target discovery must later produce.
* [ ] **P5-T02** `ReplayExecutor` step state machine, resolve, wait, authorize, act, checkpoint, classify, advance.
  * Test: unit against `FakeSurfaceDriver`, the happy path returns success with typed outputs.
* [ ] **P5-T03** Condition based `waitFor` with bounded timeouts and the condition description in the timeout message.
  * Test: unit, resolves on the condition. Times out with the description present in the error.
* [ ] **P5-T04** Checkpoint evaluation, `all` and `any` modes, every assertion kind.
  * Test: unit, one per assertion kind, plus a checkpoint failure producing `CheckpointFailed` with expected and observed.
* [ ] **P5-T05** Retry policy, bounded, exponential backoff, only on `safe` steps.
  * Test: unit with fake timers, backoff timing. An irreversible step is never retried.
* [ ] **P5-T06** Recovery handlers for `TransientLoad`, `KnownInterstitial`, `StaleElement`, `SessionExpired`, each bounded and each recorded in `recoveries`.
  * Test: unit for the bounds, integration for each against its fault.
* [ ] **P5-T07** `UnexpectedDialog` escalates and never auto dismisses.
  * Test: integration against `surpriseDialog`, asserting no click was dispatched.
* [ ] **P5-T08** Output extraction and typing, with `OutputUnresolvable` on a missing required output.
  * Test: unit and integration, money parsed to a typed value, missing output is a hard failure.
* [ ] **P5-T09** `ReplayResult` assembly including `recoveries`, `drift`, `inputsHash`, and the evidence bundle.
  * Test: unit, a run with two retries reports them on a successful result.
* [ ] **P5-T10** The full integration matrix from `docs/ERROR_TAXONOMY.md` section 8, all thirteen rows.
  * Test: integration, one per row, each asserting the exact status and code.
* [ ] **P5-T11** Import graph test proving `src/replay` contains no model client.
  * Test: unit, walks the resolved import graph.
* [ ] **P5-T12** `npm run replay` CLI taking a capability ID, a version, a variant, and JSON inputs, printing a structured result.
  * Test: e2e, the CLI exits 0 on success and non zero on failure, and the printed result is valid JSON.

## Phase 6. Discovery

Read `docs/ARCHITECTURE.md` section 6.

* [ ] **P6-T01** `ModelClient` interface plus `FakeModelClient` and `CassetteModelClient`.
  * Test: unit, the cassette replays a recorded transcript deterministically.
* [ ] **P6-T02** Observation builder, pruning the accessibility tree to interactive and text bearing nodes, assigning refs, applying redaction before the prompt.
  * Test: unit, a large tree is pruned below the token budget. A fixture observation contains no unredacted PII.
* [ ] **P6-T03** Prompt construction and the tool schema, the eleven verbs plus `escalate` and `done`, versioned by `promptVersion`.
  * Test: unit, tool definitions match the action union exactly, asserted programmatically so they cannot drift.
* [ ] **P6-T04** `AgentLoop`, observe, decide, authorize, act, record, with all stopping conditions.
  * Test: unit with `FakeModelClient`, stops on done, on max steps, on max duration, on no progress. A denied action never reaches the driver. A bad ref produces a corrective observation.
* [ ] **P6-T05** `Recorder` deriving a `LocatorBundle` from the real element at action time, never from model output.
  * Test: unit, the recorded bundle contains the derived strategies. A test asserts the model's text output is never used as a selector.
* [ ] **P6-T06** `RunTrace` persistence, the full raw record separate from the artifact.
  * Test: unit, a trace round trips and contains observation hashes and authorization decisions.
* [ ] **P6-T07** `Generalizer`, the six transforms, as a pure function.
  * Test: unit, one per transform. Snapshot compare a fixture trace against an expected artifact. A sensitive literal is never emitted, asserted by scanning the JSON.
* [ ] **P6-T08** `npm run discover` CLI taking a goal, a target, and an input schema, writing the artifact plus evidence.
  * Test: e2e with the cassette, produces an artifact matching the P5-T01 fixture in shape.

## Phase 7. Escalation and operator handoff

Read `docs/ESCALATION.md` in full.

* [ ] **P7-T01** The six stuck detectors, each independently testable.
  * Test: unit, each fires on its condition and stays silent otherwise. `NoProgress` uses the accessibility hash, proven by a test where only a timestamp on the page changed.
* [ ] **P7-T02** `InterventionRequest` construction with every required field, redacted.
  * Test: unit, all fields present, payload contains no unredacted PII.
* [ ] **P7-T03** `InterventionStore` interface plus a filesystem journalled in memory implementation.
  * Test: unit, open interventions are listed, a claim is recorded, the journal survives a reload.
* [ ] **P7-T04** Operator HTTP and WebSocket API, all eight endpoints from `docs/ESCALATION.md` section 5.
  * Test: integration, each endpoint. Claim transfers control. Release returns it.
* [ ] **P7-T05** Screenshot streaming over WebSocket, throttled and masked.
  * Test: integration, frames arrive, masking applied, the stream stops on release.
* [ ] **P7-T06** CDP input forwarding, mouse and keyboard, into the same live page.
  * Test: integration, a forwarded click changes page state, proving it is the same session.
* [ ] **P7-T07** Human action recording, in page capture plus protocol capture, with sensitive values recorded as redacted.
  * Test: integration, a forwarded click and a fill both appear as `HumanActionRecord` with role and name, and the filled value is redacted.
* [ ] **P7-T08** Resume revalidation, all five branches from `docs/ESCALATION.md` section 7.
  * Test: unit, one per branch. Specifically, when the human completed the whole task the run reports success without re acting.
* [ ] **P7-T09** Human actions converted to draft steps with `provenance: 'human'`, requiring approval.
  * Test: unit, draft steps appear on a new revision and the approved artifact is unchanged.
* [ ] **P7-T10** `MockOperator` test client driving the real API, and the bare operator HTML page.
  * Test: integration, a full claim, act, release cycle completes headlessly and the run finishes.
* [ ] **P7-T11** Policy `confirm` verdicts routed through the same intervention channel.
  * Test: integration, an irreversible step during discovery raises an intervention and proceeds after approval.
* [ ] **P7-T12** `npm run serve` starting the operator console and the catalog API.
  * Test: integration, the server starts and serves the console page.

## Phase 8. Evidence and the live run

Read `docs/EVIDENCE.md`.

* [ ] **P8-T01** `EvidenceSink` writing structured logs, screenshots, snapshots, and the run manifest to `evidence/<phase>/<runId>/`.
  * Test: unit, manifest lists every artefact. Redaction applied to all of them.
* [ ] **P8-T02** Run manifest schema, linking the artifact, the trace, the result, and every capture.
  * Test: unit, a manifest round trips and every referenced file exists.
* [ ] **P8-T03** The real live discovery run against the target app with a real key. Commit the evidence directory.
  * Accept: `evidence/discovery/<runId>/` contains the transcript, the trace, screenshots, and the produced artifact. This satisfies the brief's one non negotiable requirement.
* [ ] **P8-T04** Record the cassette from that run and wire it into the E2E test.
  * Test: e2e, the full thread runs offline.
* [ ] **P8-T05** Commit a successful replay run to `evidence/replay/success/`.
* [ ] **P8-T06** Commit a `MEMBER_NOT_FOUND` replay run to `evidence/replay/businessOutcome/`.
* [ ] **P8-T07** Commit an escalating replay run to `evidence/replay/escalated/`, using `surpriseDialog`, including the intervention payload and the handoff log.
* [ ] **P8-T08** Verify no secret or PII is present anywhere under `evidence/`.
  * Test: unit, a scanner over the committed evidence directory runs as part of the suite. This test is permanent, not a one off script.

## Phase 9. Stretch, in priority order

Do not start Phase 9 until Phases 0 to 8 and 10 are complete and green. The brief says pick at most one or two.

* [ ] **P9-T01** Capability catalog. `GET /capabilities` listing approved capabilities as callable tools with generated JSON Schema, and `POST /capabilities/:id/invoke` executing a replay with typed args.
  * Test: integration, a tool definition is generated from the artifact and an invocation returns typed outputs.
* [ ] **P9-T02** Demonstrate the catalog being invoked by a model using tool calling, with the transcript committed to evidence.
* [ ] **P9-T03** Cross tenant reuse. Replay the `acme` artifact against `borealis`, failing first, then passing with a three override overlay. Commit both runs.
  * Test: integration, without the overlay it fails with `LocatorNotFound` listing every attempted strategy. With the overlay it succeeds.
* [ ] **P9-T04** Multi run stability. Replay N times and report a flakiness signal into `lifecycle.stability`.
  * Test: integration, ten replays update the counters correctly.

## Phase 10. Deliverables

* [ ] **P10-T01** `README.md`. Setup, config, the exact demo command sequence, how to run without live services, a clear statement that `apps/target` is a fixture.
  * Accept: a reader following it from a clean clone reaches a successful replay. Verify this literally, on a clean clone.
* [ ] **P10-T02** `REPORT.md`, the seven required headings in the brief's exact order and wording. One to three pages. First person. Substance drawn from the design docs, not copied from them.
  * Accept: every heading present and correctly named. Cuts section is honest and specific.
* [ ] **P10-T03** Walk `docs/REQUIREMENTS.md` end to end. Every row has a ticked task and a named passing test, or an entry in Cuts.
* [ ] **P10-T04** Clean up. No dead code, no skipped tests, no TODO comments left in the repo, no secrets, `.env.example` only.
* [ ] **P10-T05** Fresh clone verification. Clone to a new directory, install, run the full suite, run the demo path.
* [ ] **P10-T06** Optional short screen recording of the discovery run, the replay, and one escalation handoff.

---

## Walking skeleton checkpoints

The brief asks for a complete vertical slice touching every core requirement, and warns against a polished subset. Building strictly phase by phase risks arriving at the deadline with three beautiful layers and no thread through them. Three checkpoints exist to catch that early.

* **Skeleton 1, after P5-T02.** A hand authored artifact replays against the target app and returns a typed output. The production execution path exists end to end, driven by a fixture rather than by discovery.
* **Skeleton 2, after P7-T10.** A replay escalates, a mock operator claims the live session, acts on it, and hands back, and the run completes. The hardest requirement is proven before the easier ones are polished.
* **Skeleton 3, after P8-T03.** A real model driven discovery run produces an artifact that the existing executor replays. The full thread is closed.

Reach each skeleton before deepening anything behind it. If Skeleton 1 has not landed by the time Phase 5 is half done, stop adding tests to Phase 1 and push the thread forward.

## Time pressure protocol

If effort has to be capped, cut in this order. This ranking comes from the evaluation weighting in `docs/REQUIREMENTS.md`, not from what is most pleasant to build.

**Never cut.** The live discovery run (P8-T03), the business outcome split (P1-T09 and the `MEMBER_NOT_FOUND` test), a real control transfer on the same session (P7-T06), the artifact schema (P1-T01), `REPORT.md` (P10-T02). These are the brief's explicit hard requirements and its highest weighted criteria.

**Cut depth first, in this order.**

1. Phase 9 entirely. It is stretch and the brief says at most one or two, so zero is a defensible answer.
2. Target app faults, down to a minimum of `denied`, `flaky503`, `surpriseDialog`, `expireSession`, and `duplicateIds`. Each removed fault removes a row from the error matrix, so remove the ones that duplicate a proven class.
3. The second tenant variant (P2-T09), which downgrades multitenant from demonstrated to designed. The design still scores. Say so in the report.
4. Recovery handlers, down to `TransientLoad` and `KnownInterstitial`. Keep `UnexpectedDialog` escalating, because that one is a safety property.
5. Operator console HTML, down to a bare list and three buttons. The API stays fully tested either way.
6. Coverage gates outside `src/core`, `src/replay`, and `src/control`.

**Never cut to save time.** Redaction, the allowlist choke point, or the evidence scanner test. A submission that leaks data in a public repository fails on a criterion the brief lists explicitly, and the whole point of this system is that it operates on regulated data.

Anything cut goes into `PROGRESS.md` under Deferred and cut with a reason, and then into the Cuts section of `REPORT.md`. The brief rewards a documented cut and penalises a silent gap. They look identical from the outside unless you write the reason down.

---

## Cut list

Recorded as cuts are made, and copied into the Cuts section of `REPORT.md`. Format is what, why, and what would be built next.

* (none yet)
