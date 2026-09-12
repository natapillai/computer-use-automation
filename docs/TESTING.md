# Testing strategy

Test driven development is a hard requirement on this project. This document is the operating procedure, not a philosophy essay.

## 1. The cycle, non negotiable

For every behaviour.

1. **Red.** Write the test. Run it. Read the failure message and confirm it fails for the reason you intended. A test that fails with `Cannot find module` has not told you anything.
2. **Green.** Write the least code that passes. Not the code you expect to need later.
3. **Refactor.** Improve the shape with the test green. Run again.

Rules that make this real rather than ceremonial.

* One behaviour per cycle. If the test needs three assertions about three different things, it is three tests.
* Never write an implementation file before a test references it.
* Never change a test to match an implementation that surprised you. Work out which is wrong first, and say so in the commit message if it was the test.
* If you cannot write the test, the design is unclear. Stop and resolve the design, in an ADR if it is a decision.
* Bug found means test first. Reproduce it with a failing test, then fix it. Every bug leaves a test behind.

## 2. The pyramid

| Layer | Count | Runtime | What it covers | Location |
| --- | --- | --- | --- | --- |
| Unit | most | under 2s total | Pure logic in `src/core`, reducers, classifiers, parsers, generalizer | colocated `*.test.ts` |
| Contract | one suite, many subjects | under 10s | The `SurfaceDriver` interface, run against every implementation | `tests/contract/` |
| Integration | moderate | under 90s | Replay and escalation against the real local app | `tests/integration/` |
| E2E | few | under 120s | The full demo thread with a recorded model transcript | `tests/e2e/` |
| Live | one, manual | minutes | The real model driven discovery run that produces `/evidence/` | `scripts/`, never in CI |

The shape is deliberate. `src/core` has zero IO, which is why most of the interesting logic, the schema, the templating, the locator ranking, the outcome classifier, the control reducer, the redactor, the generalizer, is unit testable in milliseconds. If a piece of logic is hard to unit test, it is in the wrong module.

## 3. Test doubles

Three, each with a specific job. Nothing else is mocked.

### `FakeSurfaceDriver`

An in memory accessibility tree with scripted transitions. `click on node n4 moves the tree to state "results"`. No browser, no IO.

It exists so the replay executor, the agent loop, the control plane, and the escalation flow are unit testable at speed, including every branch of the error taxonomy. Injecting a locator miss into the fake takes one line. Injecting it into a real browser takes a fixture page.

It must pass `tests/contract/surfaceDriver.contract.ts`. A fake that has drifted from the real driver's semantics is worse than no fake, and the contract suite is what prevents that.

### `FakeModelClient`

Returns a scripted sequence of tool calls. Used for testing the agent loop's control flow, its stopping conditions, its budget enforcement, and its escalation triggers. Deterministic, instant, free.

### `CassetteModelClient`

Replays a real recorded model transcript from `tests/fixtures/cassettes/`. Used in the E2E test so the full discovery thread runs end to end with real model output and zero network. Record once with `npm run discover -- --record-cassette`, commit the redacted transcript, and it runs forever in CI. Matching is positional with a shape assertion. Exchange N answers the Nth call, and the client asserts that the tool set and the observation hash match what was recorded, so a prompt edit is free and a change in what the model can see fails loudly. See ADR 0017. The committed cassette is a model transcript in a public repository, so the evidence scanner covers it too.

This is how we get an honest end to end test of a non deterministic system. The model's decisions are real, they are just frozen.

## 4. Determinism rules for tests

* No network in unit, contract, or integration tests. The local target app on `127.0.0.1:4010` is not the network, it is a fixture. There is one test that asserts no outbound request left the machine during the suite.
* No real model calls in CI. `ANTHROPIC_API_KEY` is unset in CI and the live script hard fails without it, so a live call cannot happen by accident.
* No raw timers. Not in application code, not in tests. Wait on conditions. The one sanctioned delay is `Clock.delay`, used by retry backoff and the rate limiter, and it is fake under Vitest fake timers. A lint rule refuses `setTimeout`, `setInterval` and `setImmediate` in `core`, `replay`, `discovery` and `control`, which is the enforceable version of a rule that otherwise reads well and decays.
* Fixed clock. `TimeProvider` is injected. Every timestamp in a test is deterministic, which means artifacts and results can be snapshot compared.
* Deterministic IDs. `IdProvider` is injected and seeded in tests.
* Fresh target app state per integration test file, via `/__control__/reset`.
* No shared mutable state between test files. Vitest runs files in parallel and a shared browser is a flake factory. One browser per file, reused across tests within it.

## 5. Contract testing the surface seam

`tests/contract/surfaceDriver.contract.ts` exports a suite function.

```ts
export function surfaceDriverContract(name: string, factory: () => Promise<SurfaceDriver>) {
  describe(`SurfaceDriver contract: ${name}`, () => {
    it('observe returns a normalised tree with unique refs within a snapshot', ...);
    it('refs are invalidated by a state change and re resolution is required', ...);
    it('resolve returns not_found for a bundle matching nothing', ...);
    it('resolve returns ambiguous for a unique policy matching several nodes', ...);
    it('resolve honours framePath', ...);
    it('observe attaches a derivedLabel to a node with no accessible name', ...);
    it('resolve honours a geometric relation, sameRow and below', ...);
    it('act rejects a stale control token with ControlLostError', ...);
    it('act on a disabled control returns a typed failure, it does not throw', ...);
    it('waitFor resolves when the condition becomes true', ...);
    it('waitFor times out with the condition description in the message', ...);
    it('extract returns the declared attribute', ...);
    it('capture returns a reference that resolves to stored bytes', ...);
  });
}
```

Both `WebSurfaceDriver` and `FakeSurfaceDriver` import and run it. This suite is the real definition of the seam, and it is what makes the claim "a desktop driver would slot in" credible rather than aspirational.

## 6. What must be tested, by module

Use this as a checklist when writing the tests for each phase. It maps to the slices in `docs/PLAN.md`.

**`core/capability`.** Valid artifacts parse. Every invalid shape is rejected with a useful message. Unknown `schemaVersion` is refused. Template resolution across inputs, prior outputs, and env. Unresolved reference is a hard failure. A retry on a non idempotent step fails validation. `redactionApplied` cannot be false, and the writer refuses an artifact carrying a sensitive literal, which is where the actual enforcement lives. Overlay merge for base, vendor, tenant. An overlay may rebind an output and may not change its contract. An overlay outside its `appliesTo` range refuses to load. Version bump rules over fixture pairs.

**`core/locator`.** Strategy ordering by confidence. First resolving strategy wins. Ambiguity under `unique` rejects the strategy and moves on. All strategies ambiguous yields `LocatorAmbiguous`. Degradation is recorded when a lower ranked strategy wins. Derivation from a `UINode` produces the expected bundle. Anchor relative resolution in a table row. Frame path scoping.

**`core/outcome`.** Each matcher kind, including the combinators. One total precedence order, step then capability then app profile, with business outcome beating failure inside a tie. The app profile cannot declare a business outcome. Recovery bounds. Retry only on idempotent steps. Every `FailureClass` constructible with required `expected` and `observed`. The classifier is exhaustive, proven by a type level never check plus a test for the unknown case.

**`core/policy`.** The table in `docs/SAFETY.md` section 6.

**`core/redaction`.** Every pattern, positives and negatives. Luhn validation. Provenance propagation. Object traversal including nested arrays. Idempotence, redacting twice equals redacting once.

**`discovery/generalizer`.** Fixture trace in, expected artifact out, snapshot compared. Failed attempts pruned. Literals matching inputs parameterised. Sensitive literals never emitted. URLs canonicalised. Waits inferred as conditions not durations. Checkpoints inferred from the following observation. Outputs typed from extract calls.

**`discovery/agentLoop`.** Stops on done plus a verified success condition. Stops on max steps. Stops on max duration. Escalates on no progress. Escalates on the model calling escalate. Denied actions do not reach the driver. A model tool call with a bad ref produces a corrective observation rather than a crash.

**`replay/executor`.** Every row of the test matrix in `docs/ERROR_TAXONOMY.md` section 8. The post action wait is a race, proven by a business outcome that classifies well inside the step timeout. The import graph of `src/replay` contains no model client, asserted as a test.

**`control`.** Every legal transition. Every illegal transition throws. Token rotation invalidates the previous holder. Claim timeout releases the session. Concurrent claim, only one wins.

**`escalation`.** Each of the six detectors fires on its condition and does not fire otherwise. Intervention payload carries every required field. Payload is redacted. `MockOperator` completes a full claim, act, release cycle. Resume revalidation covers every branch including the approval grant. A forwarded click produces a derived `LocatorBundle` through the hit test path, and no typed value is recorded anywhere. An approval grant is consumed exactly once.

## 7. Coverage gates

Enforced in `vitest.config.ts` and in CI.

| Path | Lines | Branches |
| --- | --- | --- |
| `src/core/**` | 95 | 90 |
| `src/replay/**` | 90 | 85 |
| `src/control/**` | 95 | 90 |
| `src/escalation/**` | 85 | 80 |
| `src/discovery/**` | 80 | 70 |
| everything else | 70 | 60 |

Coverage is a floor that catches untested branches, not a target to farm. A module at 95 percent with no assertion about behaviour is worse than one at 80 percent with sharp tests. The gates exist so that a whole branch of the error taxonomy cannot go untested unnoticed.

The agent loop's threshold is lower on purpose. Its prompt construction and model interaction are genuinely better verified by the cassette E2E test than by unit tests asserting on prompt strings.

## 8. The live run

Exactly one thing in this project cannot be tested deterministically, and the brief insists on it. "The discovery run has to be real."

`npm run discover` with a real key, against the local target app, once per meaningful change to the discovery pipeline. It writes the transcript, the trace, the screenshots, and the artifact into `evidence/discovery/<runId>/`. That directory is committed. It is the proof the brief asks for.

The same run records the cassette that makes the E2E test deterministic afterwards. One real run, permanent regression value.

## 9. CI

```
npm run typecheck
npm run lint
npm run test           unit and contract, with coverage gates
npm run test:integration   starts the target app, runs Playwright headless
npm run test:e2e       cassette driven full thread
```

Green on all five is the merge bar. There is no green with a skipped test. If something must be skipped it is deleted and recorded as a cut in `PROGRESS.md`, because a permanently skipped test is a lie in the suite.
