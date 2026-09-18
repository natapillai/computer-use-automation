# Escalation, control transfer, and handoff

The brief is explicit that this must be real and well reasoned, "not just a TODO". It is also the requirement most submissions will fake. The control transfer model and the handoff mechanism are implemented and integration tested. Only the operator page is allowed to be bare.

## 1. The core idea

Automation and a human share one live browser session. The only way that is safe is if exactly one of them holds control at any moment, and if that fact is enforced by the code path that actually touches the page rather than by convention.

`SurfaceDriver.act()` requires a `ControlToken`. The `ControlPlane` issues exactly one valid token per session. If the token is not current, `act()` throws `ControlLostError` before touching the page. A race between an operator click and a queued automation action is therefore structurally impossible, not merely unlikely.

The second requirement is that the operator can reach the session at all. The run process hosts the operator API and page on :4020 for its own lifetime, blocks in `pending_human` when it escalates, and prints the intervention URL to stdout. Running the executor in one process and the operator API in another leaves the human pointed at a browser they cannot touch, which is the version of this feature that demos well and does nothing. See ADR 0016.

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

`pending_human` has a timeout. If nobody claims within `INTERVENTION_CLAIM_TIMEOUT_MS` the run terminates as `escalated` with `unclaimed`, rather than holding a browser session open forever.

The transitions are a pure reducer, so every legal and illegal transition is unit tested without a browser. Illegal transitions throw. There is no path from `human` back to `automation` that does not pass through `resuming`.

## 3. Detecting stuck

Stuck means the system does not know what to do next. Three detectors raise an intervention through one function, `Escalation.raise(context)`, and each is unit tested on its own.

| Detector | Trigger | Phase |
| --- | --- | --- |
| `NoProgress` | The observation hash is unchanged across three consecutive acting tool calls | Discovery |
| `UnclassifiedCondition` | A dialog appears that no rule claims | Both |
| `ModelRequested` | The model calls the `escalate` tool with a reason | Discovery |

`NoProgress` is the detector that catches a model failing silently. A model that keeps clicking the same dead control never asks for help, so a detector that depends on the model choosing to escalate misses exactly the failure that matters, and the live discovery run is the one run that cannot be rehearsed. It compares `a11yHash` values the trace already records and keeps a counter. Only acting tool calls count, meaning `click`, `fill`, `select`, `press` and `navigate`, because an `extract` changes nothing on the page by design. The hash covers structure, roles, names, values and states, and excludes static text, so a clock ticking in the status frame is not progress and a newly rendered result row is.

`ModelRequested` is kept because it is nearly free. The `escalate` tool exists anyway, and a model that recognises it cannot proceed should be able to say so.

A policy `confirm` is not a detector, because nothing is stuck. A write step on a healthy run needs a person to approve it, and that approval travels through the same intervention channel and resolves with a one shot grant, described in section 5.

Budget exhaustion is not stuck either. Max steps and max duration end the run as a `failure` with `Timeout`. Stuck means we do not know what to do next. Out of budget means we knew and ran out of room. Conflating them produces escalations nobody can action. A streak of failed actions and an exhausted recovery are deliberately left to that path, so they reach an engineer rather than an operator.

## 4. The intervention request

```ts
type EscalationReason =
  | 'NoProgress' | 'UnclassifiedCondition' | 'ModelRequested'
  | 'PolicyConfirmation' | 'RuleRequested' | 'resumePreconditionFailed';

interface InterventionRequest {
  id: string;
  createdAt: string;
  sessionId: SessionId;
  runId: string;
  phase: 'discovery' | 'replay';

  capability?: { id: string; version: string };
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

The session is a Playwright Chromium context owned by `SessionBroker` and reachable over the Chrome DevTools Protocol.

The operator API is served by Fastify on 127.0.0.1:4020, inside the run process.

```
GET   /                                   the operator page
GET   /interventions                      open interventions
GET   /interventions/:id                  full context, redacted
GET   /sessions/:id/screenshot            the current screenshot, masked, polled by the page
POST  /interventions/:id/claim            transfer control to a human, returns humanToken
POST  /sessions/:id/input                 forward a click or key through CDP, requires humanToken
POST  /interventions/:id/release          hand control back, { outcome, approval? }
POST  /interventions/:id/abort            terminate the run
```

`POST /sessions/:id/input` requires the human token returned by claim. That path never passes through `act()`, so it does not inherit the fencing ADR 0008 put there, and it has to carry it explicitly.

`release` carries an optional approval grant. When the intervention was raised by a policy `confirm` rather than by a stuck detector, the human is approving one action, not performing it. The grant is bound to the run, the step id and the resolved target, and `PolicyEngine` accepts it exactly once. Without it the resumed step re authorizes, is told to confirm again, and escalates in a loop until the budget ends the run.

Live control works by forwarding input over CDP, `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`, into the same page the automation was using. The operator page polls the masked screenshot, draws it on a canvas, and forwards clicks and keystrokes at the corresponding coordinates. This is genuinely the same session, with the same cookies, the same frame state, and the same half completed form. It is not a fresh browser pointed at the same URL, which is the shortcut that would fail the requirement.

Polling rather than streaming is a deliberate cut. A screenshot a second is enough to unblock a flow, and it costs one endpoint rather than a socket protocol.

The page itself is one static HTML file with a canvas, a context panel, and three buttons. That is the mocked part, and it is documented as such. The API beneath it is real and tested.

Two clients drive that API.

* The operator page a human uses.
* `MockOperator`, a test client in `tests/integration` that calls the same endpoints.

Because they share the API, every run of the integration suite exercises the handoff without a person present. That is the only way a handoff feature stays working.

## 6. Recording what the human did

Required by the brief. Two capture channels, because neither is complete alone.

1. **Hit test at the forwarding point.** Every operator click arrives at `POST /sessions/:id/input` as a coordinate. Before dispatching it, the server hit tests that coordinate with CDP `DOM.getNodeForLocation` and runs the ordinary recorder on the node it finds. The record therefore carries a real `LocatorBundle`, derived and verified exactly like a model driven one. An in page listener could only have reported a role and a name, which is too little to say which element was touched once the page has changed. Hit testing also works across frames without injecting anything into the page.
2. **Protocol capture.** CDP `Page.frameNavigated` and `Network.responseReceived` for navigations and status codes, which catches what the forwarding path cannot see, such as a redirect that follows the click.

```ts
interface HumanActionRecord {
  at: string;
  kind: 'click' | 'fill' | 'select' | 'press' | 'navigate';
  target?: { describedAs: string; bundle: LocatorBundle };  // derived, verified
  url: string;                                              // redacted
  screenshotRef?: string;
}
```

There is no value field, not even a redacted one with a length. The record answers what was touched, where and when. It does not need what was typed, and capturing it would create a copy of regulated data in evidence for no gain.

These records go to the run evidence and nowhere else. They are not converted into draft steps on a new revision of the capability, so a person unblocking a run leaves an audit trail but does not yet teach the capability. That is a cut, named in `PROGRESS.md`.

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

The approval branch exists because a `confirm` escalation is not a stuck escalation. The human is approving one action, not performing it, so on release the executor performs that action itself with a one shot grant. Checking the whole capability success condition first matters too. An operator asked to unblock a two step problem will often just finish the task, and the system should notice that and report success rather than re clicking a submit button that already posted.

`resumePreconditionFailed` escalating again rather than failing is deliberate. The operator is already engaged. Handing it straight back with "this is still not where I expected to be, here is what I see" is more useful than terminating the run and making them start over.

Every transition is appended to the run's evidence, so the audit trail says who held control at every moment. In a regulated environment that record is not optional.

## 8. Escalation during discovery versus during replay

The mechanism is shared. The consequence differs.

**Discovery.** After handback the model continues from the new state, with the human's actions summarised in its context so it does not repeat them. The generalizer does not turn human actions into steps, so a discovery run that a human had to complete does not produce an artifact. Its `DiscoveryResult` says so, and the evidence shows why.

Approving one action is not completing the run. A handback raised as `PolicyConfirmation` is a person saying yes to a write the automation then performs itself with a one shot grant, so it leaves the page exactly as it was and the run still produces its artifact. Every other reason means somebody touched the session, and the generalizer refuses that run as `HumanCompleted`. The reason is on the `handback` event in the trace, so the rule is checked against evidence rather than against a flag the loop sets.

**Replay.** The human is unblocking a production run. Their actions are recorded as evidence and never amend the artifact. A capability that keeps escalating at the same step needs re recording, and the evidence across those runs is what shows it.

## 9. Limits, stated honestly for REPORT.md

* Polled screenshots plus CDP input forwarding is adequate for an operator to unblock a stuck flow. It is not a co browsing console. Latency, multi monitor, file uploads and clipboard are not handled, and the brief puts that out of scope.
* One operator per session. There is no queue, no assignment, no shift model.
* Interventions live in an in memory store with no journal. A run owns its browser, so a process restart loses the session the intervention pointed at, which makes a restored claim worse than no claim. Evidence is written as events happen and survives. A real deployment needs durable storage and a session that outlives one process, and `InterventionStore` is the seam for the first half.
* The operator API lives inside the run process, so an intervention is only claimable while that run is alive. That is the honest consequence of one process and a filesystem, and it is the first thing a real deployment would change.
* The operator is trusted. There is no per operator permission model. Their actions are recorded, which gives after the fact audit rather than prevention. The one control that does apply during their window is the network level refusal in `docs/SAFETY.md` section 5.
