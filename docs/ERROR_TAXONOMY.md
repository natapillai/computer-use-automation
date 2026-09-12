# Error taxonomy and the replay result contract

The brief's glossary singles this out. "No such member is a legitimate answer the caller needs, not a crash. Conflating the two is the most common design mistake here." This document is how we avoid it.

## 1. The four way split

Every moment during replay resolves to exactly one of four categories. The categories are mutually exclusive and the classifier is exhaustive, so nothing falls through into a generic error.

| Category | Meaning | Who acts on it | Run continues |
| --- | --- | --- | --- |
| **Success** | The success condition held and all required outputs resolved | The calling agent uses the outputs | Finished |
| **Business outcome** | A declared, expected, non success answer from the application | The calling agent branches on the code | Stops, cleanly |
| **Recoverable condition** | A transient or known interruption we can handle ourselves | Nobody, we handle it and carry on | Yes |
| **Failure** | Something we did not anticipate or cannot safely handle | An engineer debugs it | Stops, with evidence |

Escalation is orthogonal. Any of the last three can escalate to a human instead of terminating, when policy says a person should decide. That is covered in `docs/ESCALATION.md`.

## 2. The result contract

```ts
type ReplayResult =
  | SuccessResult
  | BusinessOutcomeResult
  | EscalatedResult
  | FailureResult;

interface ResultBase {
  runId: string;
  capability: { id: string; version: string; variant: string };
  inputNames: string[];          // which inputs were supplied, never their values
  startedAt: string;
  endedAt: string;
  stepsAttempted: number;
  stepsCompleted: number;
  recoveries: RecoveryRecord[];     // what we handled silently, always reported
  interventions: InterventionRecord[];  // when a human held the session, always reported
  drift: DriftRecord[];             // locator degradation and fingerprint mismatches
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
  intervention: { id: string; reason: EscalationReason; atStepId: string; disposition: 'unclaimed' | 'aborted' };
}

interface FailureResult extends ResultBase {
  status: 'failure';
  failure: {
    class: FailureClass;
    atStepId: string;
    stepIntent: string;          // plain language, so the error reads like a sentence
    expected: string;
    observed: string;
    locatorAttempts?: LocatorAttempt[];   // every strategy tried and why it was rejected
    cause?: string;
    retryable: boolean;
  };
}
```

Three details that matter.

`recoveries` is always present even on success, and `interventions` behaves the same way. A run that succeeded after three retries, a dismissed dialog and a human taking the session for ninety seconds is not the same as a clean run, and hiding either is how an unreliable capability keeps looking healthy.

`inputNames` rather than `inputs` or a hash of them. The result travels through logs and inputs contain member IDs. A hash was the first answer and it was wrong, because an unkeyed hash of a five digit identifier is reversible by enumeration, and a keyed one needs key management to tell a debugger something the field names already say.

`escalated` is a terminal status only when the intervention went unclaimed or was aborted. A claimed and released intervention resumes, and the run then reports whatever actually happened, with the episode recorded in `interventions`. See ADR 0016.

`failure.expected` and `failure.observed` are required strings. The brief asks for enough detail to debug, specifically what step, what was expected, what was observed. Making them required fields forces every failure construction site to answer the question.

## 3. Failure classes

A closed union. Adding a member is a deliberate act with a test.

```ts
type FailureClass =
  | 'LocatorNotFound'        // no strategy in the bundle resolved
  | 'LocatorAmbiguous'       // resolved to multiple nodes under a unique match policy
  | 'CheckpointFailed'       // the action ran but the state we expected did not appear
  | 'PreconditionFailed'     // we were not in the state the step assumed
  | 'Timeout'                // a bounded wait expired
  | 'SessionExpired'         // authentication lapsed and re auth was not permitted or failed
  | 'PolicyDenied'           // the allowlist or risk rules refused the action
  | 'ControlLost'            // a human holds the session and automation tried to act
  | 'OutputUnresolvable'     // a required output could not be read or parsed
  | 'SurfaceUnavailable'     // the application returned an error page or would not load
  | 'InputValidation'        // supplied inputs failed the declared constraints, fails before opening a browser
  | 'SchemaIncompatible'     // artifact schemaVersion is not supported by this engine
  | 'Internal';              // our bug, and it is labelled as ours
```

`LocatorAmbiguous` being distinct from `LocatorNotFound` is worth the extra member. They have opposite fixes. Not found usually means drift. Ambiguous usually means the recording captured a locator that was unique on a one result page and is not unique on a multi result page, which is a recording quality bug.

`Internal` exists so that our own defects are never disguised as surface problems. A classifier that cannot categorise something returns `Internal`, not a guess.

## 4. Recoverable conditions

Each is a detector plus a bounded strategy. All of them are recorded in `recoveries` even when they work.

| Condition | Detection | Strategy | Bound |
| --- | --- | --- | --- |
| `TransientLoad` | Navigation pending, spinner present, HTTP 502 or 503 | Wait on the condition, then retry the step | 3 attempts, exponential backoff from 500ms |
| `KnownInterstitial` | A matcher declared in the artifact or the app profile | Dismiss via the declared action, then re evaluate the precondition | 2 per step, 5 per run |
| `StaleElement` | Resolution succeeded then the handle detached | Re observe and re resolve once | 1 per action |
| `SessionExpired` | Redirect to login or a session matcher fires | Re authenticate through the session broker, then restart the capability from step zero if every completed step was a read, otherwise escalate | 1 per run, only if `policy.allowReauth` |
| `UnexpectedDialog` | A dialog appeared that no matcher claims | Capture it, then escalate. Never auto dismiss | 0 |

That last row is the important one. An unexpected dialog in a banking application is exactly the thing you must not click through. We screenshot it, escalate, and let a person read it. Playwright auto dismisses native dialogs when no handler is registered, which would perform that exact click through by default, so a handler is always registered and it neither accepts nor dismisses. The target app fault renders an HTML modal rather than a native dialog for the same reason a real operator console would need one. A native dialog does not appear in a screenshot and cannot be reached by forwarded CDP input, so it would break the handoff as well.

The `SessionExpired` row is the second most important. After a re login the browser is at the landing page, so resuming from the current step precondition cannot work. Restarting is only safe when nothing has been written yet, and that condition is checked rather than assumed.

Retries are only permitted on steps declared `idempotent`, which is a different question from whether the step writes. A `fill` is idempotent so retrying is free. A search submit is a read that is not idempotent, so it is not retried either. A submit that may already have posted has its postcondition re evaluated instead of being repeated. The rule is enforced by a schema refinement, so an artifact that tries to retry a non idempotent step does not validate. See ADR 0014 for why this is two properties rather than one enum.

## 5. Condition detectors

A detector is a declarative matcher, evaluated against an `Observation`. Never a string search over raw HTML. This is the only matcher language in the system. Checkpoints, preconditions, postconditions, success conditions and outcome detectors all use it, so there is one evaluator with one set of tests rather than two unions that have to agree forever.

```ts
interface ConditionRule {
  when: ConditionMatcher;
  classify: 'business_outcome' | 'recoverable' | 'failure' | 'escalate';
  code: string;                 // 'MEMBER_NOT_FOUND' | 'TransientLoad' | ...
  action?: RecoveryAction;      // only for 'recoverable'
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
2. **Capability level.** `capability.outcomes`, declared during discovery or added by review.
3. **App profile level.** `profiles/<appId>.json`, conditions true of the whole application such as its login redirect and its generic error banner. It sits at the repository root rather than under `apps/`, which holds the target fixture, because a profile describes a vendor product and not an application we wrote. The same file also carries the route plus method risk table and the field sensitivity map, since all three are per product knowledge.

The app profile layer is what makes this scale to a vendor product used by hundreds of tenants. The session timeout page is a property of the vendor's product, not of each of the four hundred capabilities recorded against it. Declaring it once means one fix for everyone.

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

Running it every step is what stops us from clicking three more buttons on a page that already said "record not found". By the time a naive implementation reaches the final assertion it has no idea which of six steps went wrong and it may have submitted a form against the wrong member.

The wait is a race rather than a sequence. Waiting on the postcondition alone means a page that already says "No records found" burns the whole step timeout and then reports `Timeout` or `CheckpointFailed`, which turns the brief's single named mistake into a timing artefact.

Precedence is one total order and not two rules that can disagree. Step detectors, then capability outcomes, then app profile. Within a tie, business outcome beats failure. Nothing else. The earlier wording had specificity and category as separate rules, which said nothing useful when a step level failure met a capability level outcome on the same observation.

The app profile layer may classify recoverable, escalate or failure. It may not declare a business outcome, because an outcome code that is not in the capability contract would reach a calling agent that has no way to know it exists.

## 7. Waiting

There is exactly one wait primitive and it takes a condition.

```ts
waitFor(condition: ConditionMatcher, timeoutMs: number): Promise<WaitResult>
```

No `sleep`. No fixed delays. No `networkidle` as a correctness mechanism, since a legacy app with a polling frame never goes idle. Every wait names the condition it is waiting for, which means its timeout message names it too. `Timed out after 10000ms waiting for: balance cell present in frame content` is a debuggable error. `Timeout` is not.

There is a lint rule refusing the raw timer globals in `core`, `replay`, `discovery` and `control`, and a unit test to back it up. The one sanctioned delay is `Clock.delay`, which exists for retry backoff and for the rate limiter, is injected, and is fake in tests. Backoff is a delay and pretending otherwise would have made the rule unimplementable rather than strict.

## 8. Test matrix

Every row is an integration test against the local target app using its fault injection, owned by task S4-T12 in `docs/PLAN.md`, with the four write flow rows owned by S6-T13. Faults are armed through `POST /__control__/fault` with a route scope and a count, not by a query parameter, because replay controls its own URLs and a fault that fires on an unspecified first request is not a test, it is a coin toss.

| Scenario | Injection | Expected result |
| --- | --- | --- |
| Happy path | none | `success` with typed outputs |
| Unknown member | `memberId=00000` | `business_outcome`, `MEMBER_NOT_FOUND`, no failure, and classified without burning the step timeout |
| Bad input | `memberId=abc` | `failure`, `InputValidation`, before a browser is opened |
| Permission denial | seed member `10002` | `business_outcome`, `ACCOUNT_RESTRICTED` |
| Transient 503 | `flaky503` scoped to the detail route | `success`, with a `TransientLoad` recovery recorded |
| Slow load | `slow`, fixed delay under the step timeout | `success`, no recovery, the wait absorbed it |
| Hard timeout | `hang` | `failure`, `Timeout`, naming the awaited condition |
| Known interstitial | `interstitial` | `success`, with a `KnownInterstitial` recovery recorded |
| Unexpected dialog | `surpriseDialog`, an HTML modal | `escalated`, dialog screenshotted, nothing clicked |
| Session timeout, re auth allowed | `expireSession` on a read only flow | `success` after re authentication, recorded as a recovery |
| Session timeout, re auth refused | `expireSession` with `allowReauth` false | `failure`, `SessionExpired` |
| Locator drift, recovered | `relabel` | `success`, with a drift record naming the strategy that won and the one that died |
| Ambiguous locator | `duplicateIds` | `failure`, `LocatorAmbiguous`, distinct from not found |
| App error page | `500` | `failure`, `SurfaceUnavailable` |
| Write, confirmation | `member.openSubAccount`, draft | `escalated` to confirm, then `success` after a one shot approval grant |
| Write, unattended | `member.openSubAccount`, approved with `allowUnattendedReplay` | `success` with no intervention |
| Write, no double post | `flaky503` scoped to the submit route | the submit is never repeated. The postcondition is re evaluated and the run resolves from what actually happened |
| Write, validation | `validation` | `business_outcome` with the field message captured as structured data |

Two rows live outside this task. `LocatorNotFound` with every attempted strategy listed comes from replaying the base artifact against the second tenant with no overlay, which is S7-T06, and that task is explicitly cuttable. If it is cut, the class is still covered by a unit test and the report says so.

Three runs are committed to `/evidence/`. The success, because it is the thread. `MEMBER_NOT_FOUND`, because it proves the business outcome split, which the brief calls the most common design mistake. And `surpriseDialog`, because it proves the system stops rather than clicking through something it does not understand, and because the committed run carries the full handoff with it.
