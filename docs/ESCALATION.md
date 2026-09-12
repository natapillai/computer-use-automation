# Escalation, control transfer, and handoff

The brief is explicit that this must be real and well reasoned, "not just a TODO". It is also the requirement most submissions will fake. The rule for this repo is that the control transfer model and the handoff mechanism are fully implemented and integration tested. Only the operator's HTML is allowed to be bare.

## 1. The core idea

Automation and a human share one live browser session. The only way that is safe is if exactly one of them holds control at any moment, and if that fact is enforced by the code path that actually touches the page rather than by convention.

`SurfaceDriver.act()` requires a `ControlToken`. The `ControlPlane` issues exactly one valid token per session. If the token is not current, `act()` throws `ControlLostError` before touching the page. A race between an operator click and a queued automation action is therefore structurally impossible, not merely unlikely.

The second requirement is that the operator can reach the session at all. The run process hosts the operator API and console on :4020 for its own lifetime, blocks in `pending_human` when it escalates, and prints the intervention URL to stdout. `serve` is the same server with no run attached, for the catalog and for reading past interventions. Running the executor in one process and the operator API in another leaves the human pointed at a browser they cannot touch, which is the version of this feature that demos well and does nothing. See ADR 0016.

## 2. Control state machine

```
                 +---------------------------------------------------+
                 v                                                   |
   IDLE --> AUTOMATION --pause--> PENDING_HUMAN --claim--> HUMAN --release--> RESUMING
              ^     |                   |                    |                  |
              |     |                   |                    |                  |
              |     +--complete--> DONE |                    +--abort--> ABORTED
              |                         |
              |                    (claim timeout)
              |                         |
              +---- resume -------------+
```

```ts
type ControlState = 'idle' | 'automation' | 'pending_human' | 'human' | 'resuming' | 'done' | 'aborted';

interface SessionControl {
  sessionId: SessionId;
  state: ControlState;
  holder: 'automation' | 'human' | null;
  token: ControlToken;            // rotated on every transition
  runId: string | null;
  interventionId: string | null;
  updatedAt: string;
}
```

The token rotates on every transition. An action holding a stale token fails even if control has since returned to automation, because the stale holder does not know what happened in between and its assumptions about page state are void. After a handback, automation must re observe.

`pending_human` has a timeout. If nobody claims within `interventionClaimTimeoutMs` the run terminates as `escalated` with `unclaimed`, rather than holding a browser session open forever. This is the difference between a design and something that survives a weekend.

The transitions are a pure reducer in `src/control/reducer.ts`, so every legal and illegal transition is unit tested without a browser. Illegal transitions throw. There is no path from `human` back to `automation` that does not pass through `resuming`.

## 3. Detecting stuck

Escalation is raised by a single function, `Escalation.raise(context)`, called from six detectors. Each one is independently unit tested.

| Detector | Trigger | Phase |
| --- | --- | --- |
| `NoProgress` | The observation hash is unchanged for N consecutive model actions | Discovery |
| `ActionFailureStreak` | M consecutive actions failed to produce their expected effect | Both |
| `ModelRequested` | The model called the `escalate` tool with a reason | Discovery |
| `PolicyConfirmation` | An action the profile classifies as a `write` needs a human decision | Both |
| `UnclassifiedCondition` | A dialog or error appeared that no detector claims | Replay |
| `RecoveryExhausted` | A recoverable condition hit its bound without resolving | Replay |

`NoProgress` uses the hash of the normalised accessibility skeleton, not the screenshot, so a blinking cursor or a rotating advert does not count as progress. That is a small detail that makes the detector actually work.

Budget exhaustion, meaning max steps or max duration, is not stuck. It is a `failure` with `Timeout`. Stuck means we do not know what to do next. Out of budget means we knew and ran out of room. Conflating them produces escalations nobody can action.

## 4. The intervention request

```ts
interface InterventionRequest {
  id: string;
  createdAt: string;
  sessionId: SessionId;
  runId: string;
  phase: 'discovery' | 'replay';

  capability?: { id: string; version: string; variant: string };
  goal?: string;                     // discovery runs have a goal, replays have a capability

  reason: EscalationReason;
  explanation: string;               // plain language, written for a person, not a stack trace
  atStep: { id: string; index: number; intent: string } | null;

  state: {
    url: string;                     // redacted
    framePath: string[];
    screenshotRef: string;           // sensitive regions masked before write
    snapshotRef: string;             // accessibility tree, redacted
    recentActions: ActionSummary[];  // last 5, with outcomes
  };

  suggestedAction: string;           // what we think the human should do
  consoleUrl: string;                // printed to stdout by the run that raised it
  expiresAt: string;
}
```

The brief asks for "enough context to act on it, which capability or goal, the current step, the current state or screenshot, and why it stopped". Every one of those is a required field. `explanation` and `suggestedAction` are written for a bank operator, not an engineer. "The search returned two members with this ID and I cannot safely choose between them. Please select the correct member and hand control back."

## 5. Taking control of the live session

The mechanism is real. The session is a Playwright Chromium context owned by `SessionBroker` and reachable over the Chrome DevTools Protocol.

Operator API, served by Fastify on port 4020.

```
GET   /interventions                       open interventions
GET   /interventions/:id                   full context, redacted
POST  /interventions/:id/claim             transfer control to a human, returns humanToken
WS    /sessions/:id/stream                 live screenshot frames, throttled, masked
POST  /sessions/:id/input                  forward a mouse or keyboard event via CDP
POST  /interventions/:id/note              record an operator note
POST  /interventions/:id/release           hand control back, { outcome, note, approval? }
POST  /interventions/:id/abort             terminate the run
```

`POST /sessions/:id/input` requires the human token returned by claim. That path never passes through `act()`, so it does not inherit the fencing ADR 0008 put there, and it has to carry it explicitly.

`release` carries an optional approval grant. When the intervention was raised by a policy `confirm` rather than by a stuck detector, the human is approving one action, not performing it. The grant is bound to the run, the step id and the resolved target, and `PolicyEngine` accepts it exactly once. Without it the resumed step re authorizes, is told to confirm again, and escalates in a loop until the budget ends the run.

Live control works by forwarding input over CDP, `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`, into the same page the automation was using. The operator console renders the screenshot stream onto a canvas and forwards clicks and keystrokes at the corresponding coordinates. This is genuinely the same session, with the same cookies, the same frame state, and the same half completed form. It is not a fresh browser pointed at the same URL, which is the shortcut that would fail the requirement.

The console itself is one static HTML file with a canvas, a context panel, and three buttons. That is the mocked part, and it is documented as such. The API beneath it is real and fully tested.

Two clients drive that API.

* `OperatorConsole`, the browser page a human uses.
* `MockOperator`, a test client in `tests/integration` that calls the exact same HTTP endpoints.

Because they share the API, the handoff is exercised on every CI run without a human being present. That is the only way a handoff feature stays working.

## 6. Recording what the human did

Required by the brief. Two independent capture channels, because neither is complete alone.

1. **Hit test at the forwarding point.** Every operator click arrives at `POST /sessions/:id/input` as a coordinate. Before dispatching it, the server hit tests that coordinate with CDP `DOM.getNodeForLocation` and runs the ordinary recorder on the node it finds. The human action therefore produces a real `LocatorBundle`, derived and verified exactly like a model driven one. An in page listener could only have reported a role and a name, and a role and a name cannot be replayed, which would have made the draft steps this section produces useless. Hit testing also works across frames without injecting anything into the page.
2. **Protocol capture.** CDP `Page.frameNavigated` and `Network.responseReceived` for navigations and status codes, which catches what the forwarding path cannot see, such as a redirect that follows the click.

```ts
interface HumanActionRecord {
  at: string;
  kind: 'click' | 'fill' | 'select' | 'press' | 'navigate' | 'note';
  target?: { describedAs: string; bundle: LocatorBundle };  // derived, replayable
  url: string;                                              // redacted
  screenshotRef?: string;
}
```

There is no value field, not even a redacted one with a length. A typed value is never needed. When a human fills a field, the draft step that results binds that field to an input template, and the value itself is the caller's to supply at replay. Capturing it would create a copy of regulated data in evidence for no gain, and the safest version of a field is the one that does not exist.

These land in the run evidence, and they are also converted into candidate steps with `provenance: 'human'` and offered as a draft revision of the capability. That is the loop closing. A human unblocking the automation teaches the capability, and because the revision is a draft requiring approval, nothing a human improvised at 2am starts running unattended.

## 7. Handing control back

On release the run does not blindly resume from where it stopped. The page may be in a completely different state now, which is the whole point of the human being there.

```
release
  -> ControlPlane: human -> resuming, rotate token
  -> executor re observes from scratch
  -> revalidate(currentStep):
       success condition of the whole capability now holds?  -> finish as success, collect outputs
       a declared business outcome now matches?              -> finish as that outcome
       the current step's postcondition now holds?           -> mark satisfiedByHuman, advance
       release carried an approval grant?                    -> re authorize with the grant, perform once
       the current step's precondition holds?                -> retry the step once
       otherwise                                             -> escalate again, reason resumePreconditionFailed
  -> ControlPlane: resuming -> automation
```

The approval branch exists because a `confirm` escalation is not a stuck escalation. The human is approving one action, not performing it, so on release the executor performs that action itself with a one shot grant. Without that branch the resumed step asks policy again, hears confirm again, and escalates forever. Checking the whole capability success condition first matters. An operator asked to unblock a two step problem will often just finish the task, and the system should notice that and report success rather than re clicking a submit button that already posted.

`resumePreconditionFailed` escalating again rather than failing is deliberate. The operator is already engaged. Handing it straight back with "this is still not where I expected to be, here is what I see" is more useful than terminating the run and making them start over.

Every transition is appended to the run's evidence, so the audit trail says who held control at every moment. In a regulated environment that record is not optional.

## 8. Escalation during discovery versus during replay

The mechanism is shared, the intent differs.

**Discovery.** The human is teaching. Their actions become candidate steps. After handback the model continues from the new state with the human's actions summarised in its context, so it does not repeat them.

**Replay.** The human is unblocking a production run. Their actions are recorded as evidence and proposed as a capability revision, but they do not silently amend an approved artifact. A repeated escalation at the same step is the signal that the capability needs re recording, and `lifecycle.stability.consecutiveFailures` is what surfaces it.

## 9. Limits, stated honestly for REPORT.md

* Screenshot streaming plus CDP input forwarding is adequate for an operator to unblock a stuck flow. It is not a production co browsing console. Latency, multi monitor, file uploads, and clipboard are not handled. The brief puts that out of scope.
* One operator per session. There is no queue, no assignment, no shift model.
* Interventions live in an in memory store with no journal. A run owns its browser, so a process restart loses the session the intervention pointed at, which makes a restored claim worse than no claim. Evidence is written as events happen and survives. A real deployment needs durable storage and a session that outlives one process, and `InterventionStore` is the seam for the first half.
* The operator API lives inside the run process, so an intervention is only claimable while that run is alive. That is the honest consequence of one process and a filesystem, and it is the first thing a real deployment would change.
* The operator is trusted. There is no per operator permission model and no verification that the human stayed inside the allowlist during their control window. Their actions are recorded, which gives after the fact audit but not prevention. This is a real limit and it goes in the report.
