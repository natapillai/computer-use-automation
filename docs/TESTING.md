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
* If you cannot write the test, the design is unclear. Stop and resolve the design.
* Bug found means test first. Reproduce it with a failing test, then fix it. Every bug leaves a test behind.

## 2. The pyramid

| Layer | Count | What it covers | Location |
| --- | --- | --- | --- |
| Unit | most | Pure logic in `src/core`, reducers, classifiers, parsers, generalizer | colocated `*.test.ts` |
| Contract | one suite, many subjects | The `SurfaceDriver` interface, run against every implementation | `tests/contract/` |
| Integration | moderate | Replay and escalation against the real local app | `tests/integration/` |
| E2E | few | The full demo thread with a recorded model transcript | `tests/e2e/` |
| Live | one, manual | The real model driven discovery run that produces `/evidence/` | never part of the suite |

The shape is deliberate. `src/core` has zero IO, which is why most of the interesting logic, the schema, the templating, the locator ranking, the outcome classifier, the control reducer, the redactor, the generalizer, is unit testable in milliseconds. If a piece of logic is hard to unit test, it is in the wrong module.

## 3. Test doubles

Three, each with a specific job. Nothing else is mocked.

### `FakeSurfaceDriver`

An in memory accessibility tree with scripted transitions. `click on node n4 moves the tree to state "results"`. No browser, no IO.

It exists so the replay executor, the agent loop, the control plane, and the escalation flow are unit testable at speed, including every branch of the error taxonomy. Injecting a locator miss into the fake takes one line. Injecting it into a real browser takes a fixture page.

It must pass `tests/contract/surfaceDriver.contract.ts`. A fake that has drifted from the real driver's semantics is worse than no fake, and the contract suite is what prevents that.

### `FakeModelClient`

Returns a scripted sequence of tool calls. Used for testing the agent loop's control flow, its stopping conditions, its budgets, and its stuck detectors. Deterministic, instant, free.

### `CassetteModelClient`

Replays a real recorded model transcript from `tests/fixtures/cassettes/`. Used in the E2E test so the full discovery thread runs end to end with real model output and zero network. Record once from the live run, commit the redacted transcript, and it runs on every suite run. Matching is positional with a shape assertion. Exchange N answers the Nth call, and the client asserts that the tool set and the observation hash match what was recorded, so a prompt edit is free and a change in what the model can see fails loudly. See ADR 0017. The committed cassette is a model transcript in a public repository, so the evidence scanner covers it too.

This is how we get an honest end to end test of a non deterministic system. The model's decisions are real, they are just frozen.

## 4. Determinism rules for tests

* No network in unit, contract, or integration tests. The local target app on `127.0.0.1:4010` is a fixture, not the network. This is a rule enforced by review. The automated socket guard was cut.
* No real model calls in the suite. No test reads `ANTHROPIC_API_KEY`, and the live discovery command hard fails without it, so a live call cannot happen by accident.
* No raw timers. Not in application code, not in tests. Wait on conditions. The one sanctioned delay is `Clock.delay`, used by retry backoff, and it is fake under Vitest fake timers. A grep for raw timers in `src/core`, `src/replay`, `src/discovery` and `src/control` runs before submission.
* Fixed clock. `Clock` is injected. Every timestamp in a test is deterministic, which means artifacts and results can be compared exactly.
* Deterministic IDs. `IdProvider` is injected and seeded in tests.
* Fresh target app state per integration test file, via `/__control__/reset`.
* No shared mutable state between test files. Vitest runs files in parallel and a shared browser is a flake factory. One browser per file, reused across tests within it.

## 5. Contract testing the surface seam

`tests/contract/surfaceDriver.contract.ts` exports a suite function.

```ts
export function surfaceDriverContract(name: string, factory: () => Promise<SurfaceDriver>) {
  describe(`SurfaceDriver contract: ${name}`, () => {
    it('observe returns a normalised tree with unique refs within a snapshot', ...);
    it('resolve returns not_found for a bundle matching nothing', ...);
    it('resolve returns ambiguous for a unique policy matching several nodes', ...);
    it('resolve honours framePath', ...);
    it('observe attaches a derivedLabel to a node with no accessible name', ...);
    it('resolve honours a geometric relation', ...);
    it('act rejects a stale control token with ControlLostError', ...);
    it('waitFor times out with the condition description in the message', ...);
  });
}
```

Both `WebSurfaceDriver` and `FakeSurfaceDriver` import and run it. This suite is the real definition of the seam, and it is what makes the claim "a desktop driver would slot in" credible rather than aspirational.

## 6. What must be tested, by module

A checklist for the tests each task writes.

**`core/capability`.** Valid artifacts parse. Every invalid shape is rejected with a useful message. Unknown `schemaVersion` is refused. Template resolution across inputs, prior outputs, and env. Unresolved reference is a hard failure. A retry on a non idempotent step fails validation. `redactionApplied` cannot be false, and the writer refuses an artifact carrying a sensitive literal, which is where the actual enforcement lives.

**`core/locator`.** Strategy ordering. First resolving strategy wins. Ambiguity under `unique` rejects the strategy and moves on. All strategies ambiguous yields `LocatorAmbiguous`. Nothing resolving yields `LocatorNotFound` with every attempt listed. Degradation is recorded when a lower ranked strategy wins. Derivation from a `UINode` produces the expected bundle. Anchor relative resolution by geometry. Frame path scoping.

**`core/outcome`.** Each matcher kind, including the combinators. One total precedence order, step then capability then app profile, with business outcome beating failure inside a tie. The app profile cannot declare a business outcome. The login redirect classifies as `SessionExpired`. Retry only on idempotent steps. Every `FailureClass` constructible with required `expected` and `observed`.

**`core/policy`.** The table in `docs/SAFETY.md` section 6.

**`core/redaction`.** Every pattern, positives and negatives. Luhn validation. Provenance propagation. Object traversal including nested arrays. Idempotence, redacting twice equals redacting once.

**`discovery/generalizer`.** Fixture trace in, expected artifact out. Failed attempts pruned. Literals matching inputs parameterised, including in locator text. Input values in navigate paths and URL patterns canonicalised to templates. Sensitive literals never emitted. Checkpoints inferred from the following observation. Outputs typed from extract calls. A synthesized success condition that does not hold fails the run.

**`discovery/agentLoop`.** Stops on done plus a verified success condition. Stops on max steps. Stops on max duration. `NoProgress` fires after three acting calls with an unchanged observation hash, and stays silent when only static text such as a timestamp changed. `ModelRequested` fires when the model calls escalate. Denied actions do not reach the driver. A model tool call with a bad ref produces a corrective observation rather than a crash.

**`replay/executor`.** Every row of the test matrix in `docs/ERROR_TAXONOMY.md` section 8. The post action wait is a race, proven by a business outcome that classifies well inside the step timeout. The import graph of `src/replay` contains no model client, asserted as a test.

**`control`.** Every legal transition. Every illegal transition throws. Token rotation invalidates the previous holder. Claim timeout ends the run as `escalated` with `unclaimed`.

**`escalation`.** `UnclassifiedCondition` fires on a dialog no rule claims and not otherwise. Intervention payload carries every required field. Payload is redacted. `MockOperator` completes a full claim, act, release cycle. Resume revalidation covers every branch including the approval grant. A forwarded click produces a derived `LocatorBundle` through the hit test path, and no typed value is recorded anywhere. An approval grant is consumed exactly once.

## 7. The live run

Exactly one thing in this project cannot be tested deterministically, and the brief insists on it. "The discovery run has to be real."

`npm run discover` with a real key, against the local target app. It writes the transcript, the trace, the screenshots, and the artifact into `evidence/discovery/<runId>/`. That directory is committed. It is the proof the brief asks for.

The same run records the cassette that makes the E2E test deterministic afterwards. One real run, permanent regression value.

## 8. Running the suite

```
npm run typecheck
npm run test
npm run test:integration   starts the target app, runs Playwright headless
npm run test:e2e           cassette driven full thread
```

There is no CI and no coverage gate. Both were cut as tooling about the suite rather than the system. A reviewer runs these four commands, and `README.md` gives them in order.

There is no green with a skipped test. If something must be skipped it is deleted and recorded as a cut in `PROGRESS.md`, because a permanently skipped test is a lie in the suite.
