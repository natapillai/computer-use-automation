# Architecture

## 1. The shape of the system

Two execution paths share one set of primitives.

**Discovery path.** Expensive, non deterministic, runs once per capability.

```
goal + target
  -> AgentLoop
       observe  -> Observation (accessibility tree, url, frame path, last result)
       decide   -> model tool call
       authorize-> PolicyEngine
       act      -> SurfaceDriver
       record   -> RunTrace
  -> Generalizer
  -> Capability artifact  (capabilities/<id>@<version>.json)
```

**Replay path.** Cheap, deterministic, runs every time an agent invokes the capability.

```
capability id + typed inputs
  -> CapabilityLoader (base artifact + variant overlay)
  -> ReplayExecutor
       resolve locator -> wait -> authorize -> act -> checkpoint -> classify
  -> ReplayResult  (success | business_outcome | escalated | failure)
```

Both paths sit on the same four primitives. `SurfaceDriver` for perception and action, `PolicyEngine` for authorisation, `ControlPlane` for who is allowed to act, `EvidenceSink` for logs, screenshots, and snapshots. That sharing is deliberate. Anything the discovery loop can do, replay can do, and anything guarded during discovery is guarded during replay.

## 2. Module boundaries

The rule is that `src/core` has zero IO. No Playwright, no fs, no network, no Anthropic SDK. It holds the schema, the templating, the locator model, the outcome taxonomy, the policy engine, and the redactor. This is what makes the bulk of the system testable in milliseconds and it is why the test pyramid works.

Everything with IO lives outside `core` and depends inward. `surface`, `discovery`, `replay`, `control`, `escalation`, `evidence`, `catalog`, `cli`. No module in that list imports another one's internals, only its public entry point.

Dependency direction is strictly inward toward `core`. If you need `core` to know about Playwright, the abstraction is wrong.

## 3. The central seam, SurfaceDriver

This is the most important interface in the repository. It is the seam between *how we perceive and act on a surface* and *the recorded flow*. Get this right and a desktop surface is a new implementation rather than a rewrite.

```ts
export interface SurfaceDriver {
  readonly kind: SurfaceKind;              // 'web' | 'legacy-web' | 'desktop'
  readonly sessionId: SessionId;

  observe(opts?: ObserveOptions): Promise<Observation>;
  act(action: ResolvedAction, control: ControlToken): Promise<ActionResult>;
  resolve(bundle: LocatorBundle, control: ControlToken): Promise<Resolution>;
  capture(kind: EvidenceKind): Promise<EvidenceRef>;
  close(): Promise<void>;
}
```

`Observation` is surface agnostic. It is a pruned accessibility tree of `UINode` values, each carrying a role, an accessible name, a value, an enabled and visible flag, a frame path, a per snapshot `ref`, and the raw platform handle that only the driver understands.

```ts
interface UINode {
  ref: string;              // 'n17', stable within one snapshot only
  role: string;             // ARIA or platform role, normalised
  name: string;             // accessible name
  value?: string;
  state: { disabled: boolean; visible: boolean; focused: boolean; checked?: boolean };
  framePath: string[];      // [] for top document, then frame names or indices
  children: UINode[];
  raw: unknown;             // driver private, never serialised
}
```

The action vocabulary is deliberately small and surface neutral.

`navigate`, `click`, `fill`, `select`, `press`, `hover`, `scroll`, `waitFor`, `extract`, `assert`, `dismiss`.

A desktop driver implements the same eleven verbs against UI Automation on Windows or AX on macOS. There is no browser concept anywhere in the vocabulary. `navigate` on desktop means open a window or a menu path, and that mapping is declared in the artifact's surface binding rather than hardcoded.

Three implementations.

* `WebSurfaceDriver`. Playwright, Chromium. Accessibility tree first, DOM as a secondary signal for locator derivation, screenshot for evidence and for the last resort locator strategy.
* `FakeSurfaceDriver`. In memory tree, scripted state transitions, no browser. This is what makes the replay executor, the agent loop, and the control plane unit testable at speed.
* `DesktopSurfaceDriver`. Implements the interface, throws `NotImplementedError` with a documented mapping table from each verb to its UI Automation equivalent. It exists to prove the seam is real and to fail the contract suite loudly if someone widens the interface with a web only concept.

`tests/contract/surfaceDriver.contract.ts` is a single suite parameterised over driver factories. `WebSurfaceDriver` and `FakeSurfaceDriver` must both pass it. That suite is the definition of the seam.

## 4. Perception strategy and why accessibility first

The brief says to bias toward an approach that still works when there is no clean DOM. Three candidate perception strategies.

* **Raw DOM plus CSS selectors.** Fails the brief. Legacy enterprise apps have no test IDs, nested table layouts, generated IDs, and framesets. Selectors derived from that markup are the brittleness the brief is warning about.
* **Screenshot plus coordinates.** Works on anything including desktop, but coordinates are the least stable thing in existence and it makes replay dependent on viewport, zoom, and font rendering. It also burns tokens.
* **Accessibility tree.** Available in browsers and in operating systems, semantically meaningful, tolerant of markup churn, compact enough to put in a prompt, and it is the same abstraction on a desktop app. It degrades on genuinely awful markup, which is why it is the primary signal and not the only one.

Decision. Accessibility tree is primary. DOM attributes and geometry are captured at record time as additional locator candidates. Screenshots are captured for evidence and as a last resort locator strategy that is flagged low confidence and never used unattended.

This is ADR 0003.

## 5. Locator model

A recorded step does not store one selector. It stores a `LocatorBundle`, an ordered list of independent strategies plus a match policy.

```ts
interface LocatorBundle {
  framePath: string[];
  strategies: LocatorStrategy[];   // ordered, highest confidence first
  matchPolicy: 'unique' | 'first' | 'nth';
  nth?: number;
  describedAs: string;             // human readable, for reviews and error messages
}

type LocatorStrategy =
  | { kind: 'role-name'; role: string; name: string; exact: boolean; confidence: number }
  | { kind: 'test-id'; attr: string; value: string; confidence: number }
  | { kind: 'label'; text: string; confidence: number }
  | { kind: 'text'; text: string; exact: boolean; confidence: number }
  | { kind: 'anchor-relative'; anchor: LocatorStrategy; relation: Relation; role?: string; confidence: number }
  | { kind: 'structural'; path: string; confidence: number }
  | { kind: 'visual'; screenshotRef: string; box: Box; confidence: number };
```

`anchor-relative` is the strategy that carries legacy surfaces. It targets an element by its relationship to a stable nearby landmark, for example "the input in the same table row as the cell containing the text Savings" or "the button following the heading Confirm". That survives the markup changes that destroy CSS selectors, and it maps cleanly onto desktop accessibility relationships.

Resolution at replay tries strategies in order and stops at the first that resolves under the match policy. Three rules that matter.

1. **Ambiguity is a failure, not a coin flip.** If `matchPolicy` is `unique` and a strategy matches more than one node, that strategy is rejected and we move to the next. If every strategy is ambiguous the step fails with `LocatorAmbiguous`. Silently taking the first match is how automation clicks the wrong account.
2. **Degradation is recorded.** If the primary strategy failed and a lower ranked one succeeded, that is written to evidence and increments a drift counter on the capability for that variant. Working is not the same as healthy.
3. **Visual strategies never run unattended.** If resolution falls all the way through to `visual`, the executor escalates rather than clicking at coordinates, unless the capability explicitly opts in.

Locator bundles are derived by the recorder from the real element at action time. The model chooses an element by `ref`. It never authors a selector. This is the single highest leverage robustness decision in the system.

## 6. Discovery pipeline

```
AgentLoop -> RunTrace -> Generalizer -> Capability
```

`RunTrace` is the raw truth. Every observation hash, every model tool call, every authorisation decision, every action result, every screenshot reference. It is evidence, not a deliverable artifact.

`Generalizer` is a deterministic, unit testable, pure function from `RunTrace` plus a `GeneralizationHints` input to `Capability`. It does six things.

1. **Prune.** Drop failed attempts, corrective navigations, and no op actions that did not change the observation hash.
2. **Parameterise.** Replace literal values that match a declared input with `{{inputs.memberId}}` templates. Values that came from a `sensitive` input are always templated, never stored.
3. **Canonicalise.** Turn concrete routes into patterns, `/member/12345` becomes `/member/:memberId`, and bind the segment to an input. This is the cross tenant reuse hook.
4. **Infer waits.** Convert observed state transitions into condition based waits. Never a fixed sleep.
5. **Infer checkpoints.** For each step, the observation that followed it provides the assertion that the step worked.
6. **Type outputs.** Every `extract` call the model made becomes a typed output with its own locator bundle and a parse rule.

Keeping the generalizer pure is what lets us test artifact quality without running a browser or a model. Feed it a fixture trace, assert on the artifact.

## 7. Replay executor

A small state machine per step.

```
resolveLocator -> waitForPrecondition -> authorize -> act -> waitForPostcondition
  -> evaluateCheckpoint -> classifyOutcome -> advance | recover | outcome | fail | escalate
```

Determinism comes from five things and none of them is luck.

1. No model is constructed on this path. The dependency is not injected, so it cannot be called by accident. There is a unit test that asserts the replay module's import graph contains no model client.
2. Locators come from the artifact, resolved deterministically in priority order.
3. Waits are condition based with bounded timeouts. There is a lint rule and a test that forbid `setTimeout` used as a sleep in `src/replay`.
4. Retries are bounded, idempotent, and only permitted for steps marked `safe`. A `fill` can be retried. A submit that may have already posted cannot, so its retry policy is `none` and its recovery is a checkpoint re evaluation instead.
5. Every step asserts a checkpoint. We never assume a click worked.

Outcome classification runs after every step, not just at the end, because a "record not found" page appears mid flow and the remaining steps are then meaningless. See `docs/ERROR_TAXONOMY.md`.

## 8. Control plane

Automation and humans share one live session. That requires an explicit answer to who is allowed to act.

```
        +-----------------------------------------------+
        v                                               |
  AUTOMATION --pause--> PENDING_HUMAN --claim--> HUMAN --release--> RESUMING
        ^                     |                    |                   |
        |                     +--timeout/abort-----+                   |
        +--------------------------- resume --------------------------+
```

`ControlPlane` issues a `ControlToken` to exactly one holder per session. `SurfaceDriver.act()` takes the token as a required argument and throws `ControlLostError` if it is not current. That makes a race between a human and the automation structurally impossible rather than merely unlikely. Details and the operator API are in `docs/ESCALATION.md`.

## 9. Multitenant model

A capability is stored as a base plus sparse overlays.

```
capabilities/
  member.readSavingsBalance/
    base@1.2.0.json
    variants/
      vendorX-v9.json      // sparse overrides keyed by step id
      tenant-acme.json     // narrower still, inherits vendorX-v9
```

Resolution is `base <- vendorVariant <- tenantVariant`, applied as a typed deep merge over `steps[].target`, `steps[].value`, `app.baseUrl`, and `outcomes`. Structure, inputs, and outputs come from the base and cannot be overridden by a tenant, because a tenant changing the contract means it is a different capability.

Drift is detected rather than assumed away. Every checkpoint records a `surfaceFingerprint`, a hash of the accessibility skeleton at that point with text content excluded. On replay a fingerprint mismatch does not fail the run, since the run may still succeed through a lower ranked locator. It increments a drift signal and marks that variant `needs_review`. That is the cheap, honest answer to "how do you manage per tenant drift across thousands of app instances".

We implement base plus one variant against the two tenant flavours of the local target app. We do not build tenant plumbing.

## 10. What is stubbed, and where the seam is

Every stub is deliberate and sits on an interface that a real implementation would satisfy without changing callers.

| Stubbed | Seam | Why this is honest |
| --- | --- | --- |
| Desktop surface | `SurfaceDriver` | Interface implemented, verb to UI Automation mapping documented, contract suite would run against it |
| Operator console | HTTP plus WebSocket API | The API is real and integration tested. Only the HTML is bare |
| Capability storage | `CapabilityStore` interface, filesystem implementation | Swapping to Postgres or S3 is one class |
| Auth to the target app | Credentials from env, never persisted | Real credential handling is an identity problem, not this project's problem |
| Approval workflow | `status` field plus a gate in the executor | The state machine is real, the review UI is not |

## 11. Key trade offs, stated plainly

* **Building a local target app instead of using a public demo site.** More upfront work. In exchange we get hermetic tests, the ability to inject the exact runtime error states the brief asks for, a genuinely hostile legacy surface, and a second tenant variant for near zero extra cost. Public demo sites cannot give us an injectable session timeout or a permission denial.
* **Accessibility tree over screenshots.** Cheaper, more stable, and portable to desktop. Costs us on canvas heavy or badly authored surfaces, which is why visual is retained as a last resort strategy.
* **Single process over services.** The brief explicitly discourages scaling infrastructure. Boundaries are interfaces, not network hops. Any of them could become a service without changing callers.
* **Sparse overlays over per tenant artifacts.** Slightly more complex loading. Avoids the rebuild per tenant problem that the brief calls out, and keeps one reviewable definition of what the capability actually does.
* **Confirm irreversible actions rather than block them.** Blocking makes the system useless, since opening a sub account is both irreversible and the entire point. Reusing the escalation channel for confirmation means one control transfer mechanism instead of two.
