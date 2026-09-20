# Error taxonomy and the replay result contract

The brief's glossary singles this out. "No such member is a legitimate answer the caller needs, not a crash. Conflating the two is the most common design mistake here." This document is how we avoid it.

## 1. The four way split

Every moment during replay resolves to exactly one of four categories. The categories are mutually exclusive and the classifier is exhaustive, so nothing falls through into a generic error.

| Category | Meaning | Who acts on it | Run continues |
| --- | --- | --- | --- |
| **Success** | The success condition held and all required outputs resolved | The calling agent uses the outputs | Finished |
| **Business outcome** | A declared, expected, non success answer from the application | The calling agent branches on the code | Stops, cleanly |
| **Recoverable condition** | A transient interruption we can handle ourselves | Nobody, we handle it and carry on | Yes |
| **Failure** | Something we did not anticipate or cannot safely handle | An engineer debugs it | Stops, with evidence |

Escalation is orthogonal. A condition can escalate to a human instead of terminating when a person should decide. That is covered in `docs/ESCALATION.md`.

## 2. The result contract

```ts
type ReplayResult =
  | SuccessResult
  | BusinessOutcomeResult
  | EscalatedResult
  | FailureResult;

interface ResultBase {
  runId: string;
  capability: { id: string; version: string };
  inputNames: string[];                  // which inputs were supplied, never their values
  startedAt: string;
  endedAt: string;
  stepsAttempted: number;
  stepsCompleted: number;
  recoveries: RecoveryRecord[];          // what we handled silently, always reported
  interventions: InterventionRecord[];   // when a human held the session, always reported
  drift: DriftRecord[];                  // a lower ranked locator strategy won, always reported
  evidence: EvidenceBundle;
}

interface SuccessResult extends ResultBase {
  status: 'success';
  outputs: Record<string, TypedValue>;
}

interface BusinessOutcomeResult extends ResultBase {
  status: 'business_outcome';
  outcome: { code: string; description: string; terminal: boolean; data?: Record<string, TypedValue> };
  partialOutputs?: Record<string, TypedValue>;
}

interface EscalatedResult extends ResultBase {
  status: 'escalated';
  intervention: { id: string; reason: EscalationReason; atStepId: string | null; disposition: 'unclaimed' | 'aborted' };
}

interface FailureResult extends ResultBase {
  status: 'failure';
  failure: {
    class: FailureClass;
    atStepId: string | null;     // null only when the run failed before its first step
    stepIntent: string | null;   // plain language, so the error reads like a sentence
    expected: string;
    observed: string;
    locatorAttempts?: LocatorAttempt[];   // every strategy tried and why it was rejected
    cause?: string;
    retryable: boolean;
  };
}
```

Four details that matter.

`recoveries`, `interventions` and `drift` are always present, including on success. A run that succeeded after three retries and a human taking the session for ninety seconds is not the same as a clean run, and hiding either is how an unreliable capability keeps looking healthy.

`inputNames` rather than `inputs` or a hash of them. The result travels through logs and inputs contain member IDs. An unkeyed hash of a five digit identifier is reversible by enumeration, and a keyed one needs key management to tell a debugger something the field names already say.

`escalated` is a terminal status only when the intervention went unclaimed or was aborted. A claimed and released intervention resumes, and the run then reports whatever actually happened, with the episode recorded in `interventions`. See ADR 0016.

`failure.expected` and `failure.observed` are required strings. The brief asks for enough detail to debug, specifically what step, what was expected, what was observed. Making them required fields forces every failure construction site to answer the question.

## 3. Failure classes

A closed union. Adding a member is a deliberate act with a test.

```ts
type FailureClass =
  | 'LocatorNotFound'        // no strategy in the bundle resolved
  | 'LocatorAmbiguous'       // resolved to multiple nodes under a unique match policy
  | 'CheckpointFailed'       // the action ran but the state we expected did not appear
  | 'PreconditionFailed'     // we were not in the state the step assumed, including after a release
  | 'Timeout'                // a bounded wait expired, or a step or duration budget ran out
  | 'SessionExpired'         // the app redirected to login mid run, and nothing re authenticates
  | 'PolicyDenied'           // the allowlist or risk rules refused the action
  | 'ControlLost'            // a human holds the session and automation tried to act
  | 'OutputUnresolvable'     // a required output could not be read or parsed
  | 'SurfaceUnavailable'     // the application answered with an error the step cannot retry
  | 'InputValidation'        // supplied inputs failed the declared constraints, before a browser opens
  | 'SchemaIncompatible'     // artifact schemaVersion is not supported by this engine
  | 'Internal';              // our bug, and it is labelled as ours
```

`LocatorAmbiguous` being distinct from `LocatorNotFound` is worth the extra member. They have opposite fixes. Not found usually means drift. Ambiguous usually means the recording captured a locator that was unique on a one result page and is not unique on a multi result page, which is a recording quality bug.

A run that a person handed back three times, and that still cannot carry on, ends as `PreconditionFailed` and never as `PolicyDenied`. Nothing refused it. The step has nothing to run against. Reading a refusal there would send whoever is on call to the allowlist, which is the wrong file.

`Internal` exists so that our own defects are never disguised as surface problems. A classifier that cannot categorise something returns `Internal`, not a guess.

Three classes are defined but reached end to end by fewer paths than the rest, and that is deliberate rather than forgotten. `SessionExpired` comes from the app profile login redirect detector and ends the run, because re authentication was cut. The target app has no expiring session, so the class is covered by a classifier unit test. `SurfaceUnavailable` is reached through a 503 on a step that must not be retried. `LocatorNotFound` is covered by resolution policy unit tests, because the integration run that would list every attempted strategy needed a second tenant.

## 4. Recoverable conditions

A detector plus a bounded strategy, recorded in `recoveries` even when it works.

| Condition | Detection | Strategy | Bound |
| --- | --- | --- | --- |
| `TransientLoad` | HTTP 502 or 503 on the navigation a step caused | Retry the step, only if it is idempotent | 3 attempts, exponential backoff from 500ms |
| `UnexpectedDialog` | A dialog appeared that no rule claims | Capture it, then escalate. Never dismiss it | 0 |

Only the first row is a recovery. Known interstitials, stale element handles and session expiry are not recovered, and the reasons are in the cut list in `PROGRESS.md`. Every result already carries `recoveries[]`, so adding a handler later does not change the contract.

The second row is the important one. An unexpected dialog in a banking application is exactly the thing you must not click through. We screenshot it, escalate, and let a person read it. Playwright auto dismisses native dialogs when no handler is registered, which would perform that exact click through by default, so a handler is always registered and it neither accepts nor dismisses. The target app fault renders an HTML modal rather than a native dialog. A native dialog does not appear in a screenshot and cannot be reached by forwarded CDP input, so it would break the handoff as well.

Retries are only permitted on steps declared `idempotent`, which is a different question from whether the step writes. A `fill` is idempotent so retrying is free. A search submit is a read that is not idempotent, so it is not retried either. The rule is enforced by a schema refinement, so an artifact that tries to retry a non idempotent step does not validate. See ADR 0014 for why this is two properties rather than one enum.

A 503 on a non idempotent step is not retried. It ends the run as `SurfaceUnavailable` marked `retryable`, so the caller decides whether to invoke the capability again, and the application sees exactly one submission from this run.

## 5. Condition detectors

A detector is a declarative matcher, evaluated against an `Observation`. Never a string search over raw HTML. This is the only matcher language in the system. Checkpoints, preconditions, postconditions, success conditions and outcome detectors all use it, so there is one evaluator with one set of tests.

```ts
interface ConditionRule {
  when: ConditionMatcher;
  classify: 'business_outcome' | 'recoverable' | 'failure' | 'escalate';
  code: string;                 // 'MEMBER_NOT_FOUND' | 'TransientLoad' | ...
  captureData?: OutputSpec[];   // pull the validation message out as structured data
}

type ConditionMatcher =
  | { kind: 'elementPresent'; target: LocatorBundle }
  | { kind: 'textMatches'; target: LocatorBundle; pattern: string }
  | { kind: 'urlMatches'; pattern: string }
  | { kind: 'httpStatus'; codes: number[] }
  | { kind: 'dialogPresent' }
  | { kind: 'outputResolvable'; outputName: string }
  | { kind: 'all'; of: ConditionMatcher[] }
  | { kind: 'any'; of: ConditionMatcher[] }
  | { kind: 'not'; of: ConditionMatcher };
```

Detectors come from three layers, evaluated in this order.

1. **Step level.** `step.onCondition`, the most specific.
2. **Capability level.** `capability.outcomes`, added by the negative probe review in ADR 0018.
3. **App profile level.** `profiles/<appId>.json`, conditions true of the whole application such as its login redirect and its generic error banner. It sits at the repository root rather than under `apps/`, which holds the target fixture, because a profile describes a vendor product and not an application we wrote. The same file carries the route plus method risk table and the field sensitivity map, since all three are per product knowledge.

The app profile layer is what makes this scale to a vendor product used by hundreds of tenants. The login redirect is a property of the vendor's product, not of each of the four hundred capabilities recorded against it. Declaring it once means one fix for everyone.

## 6. The classification loop

Classification runs after every step, not only at the end.

```
act
  -> waitFor( any( step postcondition, step detectors, capability outcomes, profile conditions ) )
  -> observe once
  -> classify in precedence order:
       step detectors        -> apply the declared classification
       capability outcomes   -> business outcome, stop
       app profile           -> recoverable, escalate or failure
       step postcondition    -> pass? advance
                             -> fail? retry within budget, else CheckpointFailed
```

Running it every step is what stops us from clicking three more buttons on a page that already said "record not found". By the time a naive implementation reaches the final assertion it has no idea which step went wrong and it may have submitted a form against the wrong member.

The wait is a race rather than a sequence. Waiting on the postcondition alone means a page that already says "No records found" burns the whole step timeout and then reports `Timeout` or `CheckpointFailed`, which turns the brief's single named mistake into a timing artefact.

Precedence is one total order and not two rules that can disagree. Step detectors, then capability outcomes, then app profile. Within a tie, business outcome beats failure. Nothing else.

The app profile layer may classify recoverable, escalate or failure. It may not declare a business outcome, because an outcome code that is not in the capability contract would reach a calling agent that has no way to know it exists.

A rule classified `escalate` raises an intervention with the reason `RuleRequested`, so a condition someone declared reaches a person rather than reporting as a defect of ours.

## 7. Waiting

There is exactly one wait primitive and it takes a condition.

```ts
race(contenders: { condition: ConditionMatcher; entrant: T }[], timeoutMs: number): Promise<RaceOutcome<T>>
```

The race observes, evaluates every contender in precedence order, and returns the first that holds. Between observations it calls `SurfaceDriver.waitForChange`, which returns as soon as the surface differs from the last observation or the remaining time runs out. The web driver answers it from a per document mutation counter that Playwright checks on each animation frame. The fake answers it from a version number and spends the timeout on the injected clock.

No `sleep`. No fixed delays. No `networkidle` as a correctness mechanism, since a legacy app with a polling frame never goes idle. Every wait names the condition it is waiting for, which means its timeout message names it too. `Timed out after 10000ms waiting for: balance cell present in frame content` is a debuggable error. `Timeout` is not.

The one sanctioned delay is `Clock.delay`, which exists for retry backoff, is injected, and is fake in tests. There is no lint rule. One grep for raw timers in `src/core`, `src/replay`, `src/discovery` and `src/control` runs before submission, at S8-T03.

## 8. Test matrix

Every row but one is an integration test against the local target app, collected in S6-T04 and first proven by the task named in the last column. Ambiguous locator, action is the exception. It needs a second matching control on the page, which no fault produces, so the driver contract suite proves it against the same Playwright driver instead. Faults are armed through `POST /__control__/fault` with a route scope and a count, never by a query parameter, because replay controls its own URLs and a fault that fires on an unspecified first request is a coin toss rather than a test.

| Scenario | Injection | Expected result | First proven |
| --- | --- | --- | --- |
| Happy path | none | `success` with typed outputs | S1-T10 |
| Unknown member | `memberId` `00000` | `business_outcome`, `MEMBER_NOT_FOUND`, well inside the step timeout | S4-T01 |
| Bad input | `memberId` `abc` | `failure`, `InputValidation`, before a browser opens | S1-T03 |
| Permission denial | `denied` on member detail | `business_outcome`, `ACCOUNT_RESTRICTED` | S6-T01 |
| Transient 503 | `flaky503` on member detail, count 1 | `success`, with a `TransientLoad` recovery recorded | S6-T02 |
| Hard timeout | `hang` on member detail | `failure`, `Timeout`, naming the awaited condition | S6-T01 |
| Unexpected dialog | `surpriseDialog` | `escalated`, dialog screenshotted, nothing clicked | S5-T05 |
| Locator drift, recovered | `relabel` | `success`, with a drift record naming the strategy that won and the one that did not | S6-T01 |
| Ambiguous locator, checkpoint | `duplicateIds` | `failure`, `CheckpointFailed`, observing that the page carries two of the row | S6-T04 |
| Ambiguous locator, action | a second Search control on the page | `failure`, `LocatorAmbiguous` | S1-T09 |
| Write, confirmation | `member.openSubAccount`, draft | a confirm intervention, then `success` after a one shot approval grant | S5-T06 |
| Write, unattended | `member.openSubAccount`, approved with `allowUnattendedReplay` | `success` with no intervention | S5-T06 |
| Write, no double post | `flaky503` on the submit route | `failure`, `SurfaceUnavailable`, `retryable`, and the app recorded exactly one submission | S5-T06 |
| Write, validation | an invalid opening amount | `business_outcome` with the field message captured as structured data | S5-T06 |

Three replay runs are committed to `/evidence/replay/`. The success, because it is the thread. `MEMBER_NOT_FOUND`, because it proves the business outcome split, which the brief calls the most common design mistake. And `surpriseDialog`, because it proves the system stops rather than clicking through something it does not understand. Nobody claimed that one, so it ends unclaimed and the capture shows the dialog still open with its OK button never pressed. The handoffs a person actually took are in the discovery runs, which is where they happened.
