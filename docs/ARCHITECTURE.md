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

The rule is that `src/core` has zero IO. No Playwright, no fs, no network, no Anthropic SDK. It holds the surface model types, the schema, the templating, the locator model, the outcome taxonomy, the policy engine, and the redactor. `UINode`, `Observation` and the action vocabulary live in `core/surfaceModel`, and `src/surface/types.ts` imports them rather than the reverse. The capability schema needs the action vocabulary, so defining that vocabulary inside the surface module would have pointed the dependency outward and broken the only rule this section has. This is what makes the bulk of the system testable in milliseconds and it is why the test pyramid works.

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

Two fields on that node are there because of what the target app does to us. `derivedLabel` carries the nearest text by layout, because a form input whose label is a sibling table cell has no accessible name at all. `box` carries viewport geometry, because relations such as "the input in the same row as this text" cannot be computed from a layout table that Chromium has flattened. Geometry is used for relations between nodes and never as an absolute coordinate to click. This is ADR 0012.

```ts
interface UINode {
  ref: string;              // 'n17', stable within one snapshot only
  role: string;             // ARIA or platform role, normalised
  name: string;             // accessible name
  value?: string;
  state: { disabled: boolean; visible: boolean; focused: boolean; checked?: boolean };
  framePath: string[];      // [] for top document, then frame names or indices
  derivedLabel?: string;    // nearest text by layout, when the accessible name is empty
  box: Box;                 // viewport geometry, for relations only, never for clicking
  children: UINode[];
  raw: unknown;             // driver private, never serialised
}
```

The action vocabulary is deliberately small and surface neutral.

`navigate`, `click`, `fill`, `select`, `press`, `hover`, `scroll`, `waitFor`, `extract`, `assert`, `dismiss`.

A desktop driver implements the same eleven verbs against UI Automation on Windows or AX on macOS. There is no browser concept anywhere in the vocabulary. `navigate` on desktop means open a window or a menu path, and that mapping is declared in the artifact's surface binding rather than hardcoded.

Three implementations.

* `WebSurfaceDriver`. Playwright, Chromium. Accessibility tree first, enriched with geometry and derived labels, DOM as a secondary signal for locator derivation, screenshots for evidence only.
* `FakeSurfaceDriver`. In memory tree, scripted state transitions, no browser. This is what makes the replay executor, the agent loop, and the control plane unit testable at speed.
* `DesktopSurfaceDriver`. Implements the interface, throws `NotImplementedError` with a documented mapping table from each verb to its UI Automation equivalent. It exists to prove the seam is real and to fail the contract suite loudly if someone widens the interface with a web only concept.

`tests/contract/surfaceDriver.contract.ts` is a single suite parameterised over driver factories. `WebSurfaceDriver` and `FakeSurfaceDriver` must both pass it. That suite is the definition of the seam.

## 4. Perception strategy and why accessibility first

The brief says to bias toward an approach that still works when there is no clean DOM. Three candidate perception strategies.

* **Raw DOM plus CSS selectors.** Fails the brief. Legacy enterprise apps have no test IDs, nested table layouts, generated IDs, and framesets. Selectors derived from that markup are the brittleness the brief is warning about.
* **Screenshot plus coordinates.** Works on anything including desktop, but coordinates are the least stable thing in existence and it makes replay dependent on viewport, zoom, and font rendering. It also burns tokens.
* **Accessibility tree.** Available in browsers and in operating systems, semantically meaningful, tolerant of markup churn, compact enough to put in a prompt, and it is the same abstraction on a desktop app. It degrades on genuinely awful markup, which is why it is the primary signal and not the only one.

Decision. The accessibility tree is primary, enriched with geometry and derived labels at observation time rather than at record time only. DOM attributes are captured at record time as additional locator candidates. Screenshots are captured for evidence. They are not a locator strategy, because nothing would ever execute one and a strategy nothing executes is a guess.

This is ADR 0012, which supersedes ADR 0003.

## 5. Locator model

A recorded step does not store one selector. It stores a `LocatorBundle`, an ordered list of independent strategies plus a match policy.

```ts
interface LocatorBundle {
  framePath: string[];
  strategies: LocatorStrategy[];   // ordered, highest confidence first
  matchPolicy: 'unique' | 'nth';   // no 'first'. Taking the first match silently is the bug rule 1 forbids
  nth?: number;
  describedAs: string;             // human readable, for reviews and error messages
}

type LocatorStrategy =
  | { kind: 'role-name'; role: string; name: string; exact: boolean; confidence: number }
  | { kind: 'test-id'; attr: string; value: string; confidence: number }
  | { kind: 'label'; text: string; confidence: number }
  | { kind: 'text'; text: TemplateExpr; exact: boolean; confidence: number }
  | { kind: 'anchor-relative'; anchor: LocatorStrategy; relation: Relation; role?: string; confidence: number }
  | { kind: 'structural'; path: string; confidence: number };

// Relation is geometric. sameRow, rightOf, below, and so on, computed from boxes.
// Text bearing fields are TemplateExpr, so a member ID in a locator is parameterised
// rather than committed as a literal.
```

`anchor-relative` is the strategy that carries legacy surfaces. It targets an element by its spatial relationship to a stable nearby landmark, for example "the input in the same row as the text Savings" or "the button below the heading Confirm". The relation is computed from bounding boxes, not from markup, which matters because the target app lays its forms out in nested tables that Chromium reports as presentational. Geometry also maps directly onto desktop accessibility, where UI Automation exposes a bounding rectangle for every element.

Resolution at replay tries strategies in order and stops at the first that resolves under the match policy. Three rules that matter.

1. **Ambiguity is a failure, not a coin flip.** If `matchPolicy` is `unique` and a strategy matches more than one node, that strategy is rejected and we move to the next. If every strategy is ambiguous the step fails with `LocatorAmbiguous`. Silently taking the first match is how automation clicks the wrong account.
2. **Degradation is recorded.** If the primary strategy failed and a lower ranked one succeeded, that is written to evidence and increments a drift counter on the capability for that variant. Working is not the same as healthy.
3. **A bundle only contains strategies that were observed to work.** Each derived strategy is resolved against the live observation at record time, and one that does not uniquely hit the recorded element is dropped rather than ranked low. Without that, a bundle accumulates strategies that never worked, every replay records a degradation, and the drift signal becomes noise that nobody reads.

Locator bundles are derived by the recorder from the real element at action time. The model chooses an element by `ref`. It never authors a selector, and it is never given a tool that takes one, which is why its tool surface is deliberately narrower than the driver vocabulary. Any derived text that matches a declared input value is emitted as a template, so a member ID never reaches a committed artifact as a literal. This is ADR 0013, and it is the single highest leverage robustness decision in the system.

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
resolveLocator -> waitForPrecondition -> authorize -> act
  -> waitFor( any( postcondition, capability outcomes, app profile conditions ) )
  -> classify whichever fired
  -> advance | recover | outcome | fail | escalate
```

The wait after acting is a race, not a sequence, and that detail is load bearing. If the executor waited for the postcondition alone, a page that already says "No records found" would burn the full step timeout and then report `Timeout` or `CheckpointFailed`. A legitimate business outcome would arrive dressed as a failure, which is the single mistake the brief names in its glossary.

Determinism comes from five things and none of them is luck.

1. No model is constructed on this path. The dependency is not injected, so it cannot be called by accident. There is a unit test that asserts the replay module's import graph contains no model client.
2. Locators come from the artifact, resolved deterministically in priority order.
3. Waits are condition based with bounded timeouts. The only sanctioned delay anywhere in the system is `Clock.delay`, which exists for retry backoff, is injected, and is fake in tests. A lint rule refuses the raw timer globals in `core`, `replay`, `discovery` and `control`, so a sleep cannot be reintroduced by habit.
4. Retries are bounded and only permitted for steps declared `idempotent`, which is a separate property from `effect`. A `fill` is retried. A search submit is a read that is not idempotent, so it is not retried either, and a submit that may have already posted has its postcondition re evaluated instead of being repeated. Collapsing those two properties into one enum is what made a read capability classify as irreversible. See ADR 0014.
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

The process topology is part of this design, not an afterthought. A run hosts the operator API on :4020 for its own lifetime, blocks in `pending_human` when it escalates, and prints the intervention URL to stdout. `serve` is the same server with no run attached. Running the executor in one process and the operator API in another would leave the operator with no route to the live page, which is the shortcut that turns this requirement into a demonstration of nothing. See ADR 0016.

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

Resolution is `base <- vendorVariant <- tenantVariant`, applied as a typed merge that distinguishes bindings from contracts. An overlay may override any binding. `steps[].target`, `steps[].value`, `outputs[].source`, `outcomes[].detect`, `app.baseUrl`, and it may add `onCondition` rules or mark an existing step optional. It may not change a contract. Output name, type, sensitivity or required, the input specs, the step ids or the step order. The first version of this rule forbade output overrides entirely, which blocked the most common tenant difference there is, a value rendered in a different place. Every overlay declares `appliesTo`, a semver range over base versions, so a base that has moved on refuses to merge rather than merging wrongly. See ADR 0015.

Drift is detected rather than assumed away. Every checkpoint records a `surfaceFingerprint`, a hash of the accessibility skeleton at that point with text content excluded. On replay a fingerprint mismatch does not fail the run, since the run may still succeed through a lower ranked locator. It increments a drift counter and sets `needs_review` in `capabilities/<id>/state.json`, the per capability state sidecar. Those counters deliberately do not live inside the artifact. An artifact is an immutable versioned file that git is supposed to keep still, and rewriting it on every replay would make its history unreadable and its version meaningless. That is the cheap, honest answer to "how do you manage per tenant drift across thousands of app instances".

We implement base plus one variant against the two tenant flavours of the local target app. We do not build tenant plumbing.

## 10. What is stubbed, and where the seam is

Every stub is deliberate and sits on an interface that a real implementation would satisfy without changing callers.

| Stubbed | Seam | Why this is honest |
| --- | --- | --- |
| Desktop surface | `SurfaceDriver` | Interface implemented, verb to UI Automation mapping documented, contract suite would run against it |
| Operator console | HTTP plus WebSocket API | The API is real and integration tested. Only the HTML is bare |
| Capability storage | `CapabilityStore` interface, filesystem implementation | Swapping to Postgres or S3 is one class |
| Auth to the target app | `SessionBroker` logs in before a session is leased | No capability step ever holds a credential, so no artifact can leak one. Real credential handling is an identity problem, not this project problem |
| Approval workflow | `npm run review` writes `status`, `approvedBy` and `approvedAt` | The gate is real and the approval is a commit, so who approved what is answerable from git history. The review UI is the bare console |
| Intervention storage | `InterventionStore` interface, in memory | A process restart loses open claims and keeps all evidence. Named honestly in `docs/ESCALATION.md` section 9 |

## 11. Key trade offs, stated plainly

* **Building a local target app instead of using a public demo site.** More upfront work. In exchange we get hermetic tests, the ability to inject the exact runtime error states the brief asks for, a genuinely hostile legacy surface, and a second tenant variant for near zero extra cost. Public demo sites cannot give us an injectable session timeout or a permission denial.
* **Accessibility tree over screenshots.** Cheaper, more stable, and portable to desktop. Costs us on canvas heavy or badly authored surfaces, which is why visual is retained as a last resort strategy.
* **Single process over services.** The brief explicitly discourages scaling infrastructure. Boundaries are interfaces, not network hops. Any of them could become a service without changing callers.
* **Sparse overlays over per tenant artifacts.** Slightly more complex loading, and a merge that has to know which fields are contract and which are binding. Avoids the rebuild per tenant problem that the brief calls out, and keeps one reviewable definition of what the capability actually does.
* **Geometry as a first class part of perception.** It costs a bounding box on every node and a rule that geometry is never used to click. It buys relations that survive a layout table Chromium has flattened, and it is the same abstraction UI Automation offers on desktop.
* **Confirm irreversible actions rather than block them.** Blocking makes the system useless, since opening a sub account is both irreversible and the entire point. Reusing the escalation channel for confirmation means one control transfer mechanism instead of two.
