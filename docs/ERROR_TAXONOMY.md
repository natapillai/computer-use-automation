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
  inputsHash: string;            // hash, never the inputs themselves
  startedAt: string;
  endedAt: string;
  stepsAttempted: number;
  stepsCompleted: number;
  recoveries: RecoveryRecord[];  // what we handled silently, always reported
  drift: DriftRecord[];          // locator degradation and fingerprint mismatches
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
  intervention: { id: string; reason: EscalationReason; atStepId: string; resumeToken: string };
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

`recoveries` is always present even on success. A run that succeeded after three retries and a dismissed dialog is not the same as a clean run, and hiding that is how flakiness becomes invisible.

`inputsHash` rather than `inputs`. The result travels through logs. Inputs contain member IDs.

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
| `SessionExpired` | Redirect to login or a session matcher fires | Re authenticate via the declared session capability, then resume from the current step's precondition | 1 per run, only if `policy.allowReauth` |
| `UnexpectedDialog` | A dialog appeared that no matcher claims | Capture it, then escalate. Never auto dismiss | 0 |

That last row is the important one. An unexpected dialog in a banking application is exactly the thing you must not click through. We screenshot it, classify the run as escalated, and let a person read it.

Retries are only permitted on steps whose `risk` is `safe`. A `fill` is idempotent so retrying is free. A submit may already have posted, so its retry policy is `none` and its recovery path is to re evaluate the postcondition instead of acting again. This rule is enforced by a schema refinement, so an artifact that tries to retry an irreversible step will not validate.

## 5. Condition detectors

A detector is a declarative matcher, evaluated against an `Observation`. Never a string search over raw HTML.

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
  | { kind: 'all'; of: ConditionMatcher[] }
  | { kind: 'any'; of: ConditionMatcher[] };
```

Detectors come from three layers, evaluated in this order.

1. **Step level.** `step.onCondition`, the most specific.
2. **Capability level.** `capability.outcomes`, declared during discovery or added by review.
3. **App profile level.** `apps/<appId>/profile.json`, conditions true of the whole application such as its login redirect and its generic error banner.

The app profile layer is what makes this scale to a vendor product used by hundreds of tenants. The session timeout page is a property of the vendor's product, not of each of the four hundred capabilities recorded against it. Declaring it once means one fix for everyone.

## 6. The classification loop

Classification runs after every step, not only at the end.

```
act
  -> observe
  -> evaluate step detectors        -> match? apply classification
  -> evaluate capability outcomes   -> match? business outcome, stop
  -> evaluate app profile           -> match? recoverable or escalate
  -> evaluate step postcondition    -> pass? advance
                                    -> fail? retry within budget, else CheckpointFailed
```

Running it every step is what stops us from clicking three more buttons on a page that already said "record not found". By the time a naive implementation reaches the final assertion it has no idea which of six steps went wrong and it may have submitted a form against the wrong member.

Precedence is specific over general, and business outcome over failure. If a page matches both a declared outcome and the generic error banner, the declared outcome wins, because we were told explicitly that this is a legitimate answer.

## 7. Waiting

There is exactly one wait primitive and it takes a condition.

```ts
waitFor(condition: ConditionMatcher, timeoutMs: number): Promise<WaitResult>
```

No `sleep`. No fixed delays. No `networkidle` as a correctness mechanism, since a legacy app with a polling frame never goes idle. Every wait names the condition it is waiting for, which means its timeout message names it too. `Timed out after 10000ms waiting for: balance cell present in frame content` is a debuggable error. `Timeout` is not.

There is a unit test asserting that `src/replay` contains no bare timer used as a delay, and a lint rule to back it up.

## 8. Test matrix

Every row is an integration test against the local target app using its fault injection, listed in `docs/PLAN.md` as Phase 5. The brief asks for at least one replay that hits an error state in the evidence. We will produce several and commit two.

| Scenario | Injection | Expected result |
| --- | --- | --- |
| Happy path | none | `success` with typed outputs |
| Unknown member | `memberId=00000` | `business_outcome`, `MEMBER_NOT_FOUND`, no failure |
| Validation error | `memberId=abc` | `failure`, `InputValidation`, fails before the browser opens |
| Permission denial | `?fault=denied` | `business_outcome`, `ACCOUNT_RESTRICTED` |
| Transient 503 | `?fault=flaky503` | `success`, with a `TransientLoad` recovery recorded |
| Slow load | `?fault=slow` | `success`, no recovery, wait absorbed it |
| Hard timeout | `?fault=hang` | `failure`, `Timeout`, names the awaited condition |
| Known interstitial | `?fault=interstitial` | `success`, with a `KnownInterstitial` recovery recorded |
| Unexpected dialog | `?fault=surpriseDialog` | `escalated`, dialog screenshotted, nothing clicked |
| Session timeout | `?fault=expireSession` | `success` after re auth, or `failure` `SessionExpired` when re auth is disallowed |
| Locator drift | tenant B variant without an overlay | `failure`, `LocatorNotFound`, every attempted strategy listed |
| Ambiguous locator | search returning two members | `failure`, `LocatorAmbiguous` |
| App error page | `?fault=500` | `failure`, `SurfaceUnavailable` |

The two committed to `/evidence/` are `MEMBER_NOT_FOUND`, because it proves the business outcome split, and `surpriseDialog`, because it proves the system stops rather than clicking through something it does not understand.
