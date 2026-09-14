# Architecture

## 1. The shape of the system

Two execution paths share one set of primitives.

**Discovery path.** Expensive, non deterministic, runs once per capability.

```
goal + target
  -> AgentLoop
       observe  -> Observation (accessibility tree, geometry, url, frame path, last result)
       decide   -> model tool call, refs only
       authorize-> PolicyEngine
       act      -> SurfaceDriver
       record   -> RunTrace
  -> Generalizer
  -> Capability artifact  (capabilities/<id>@<version>.json)
```

**Replay path.** Cheap, deterministic, runs every time an agent invokes the capability.

```
capability id + version + typed inputs
  -> CapabilityLoader (one artifact file)
  -> ReplayExecutor
       resolve locator -> authorize -> act -> race(postcondition, detectors) -> classify
  -> ReplayResult  (success | business_outcome | escalated | failure)
```

Both paths sit on the same four primitives. `SurfaceDriver` for perception and action, `PolicyEngine` for authorisation, `ControlPlane` for who is allowed to act, `EvidenceSink` for logs, screenshots, and snapshots. That sharing is deliberate. Anything the discovery loop can do, replay can do, and anything guarded during discovery is guarded during replay.

## 2. Module boundaries

The rule is that `src/core` has zero IO. No Playwright, no fs, no network, no Anthropic SDK. It holds the surface model types, the schema, the templating, the locator model, the outcome taxonomy, the policy engine, and the redactor. `UINode`, `Observation` and the action vocabulary live in `core/surfaceModel`, and `src/surface/types.ts` imports them rather than the reverse. The capability schema needs the action vocabulary, so defining that vocabulary inside the surface module would have pointed the dependency outward and broken the only rule this section has. This is what makes the bulk of the system testable in milliseconds.

Everything with IO lives outside `core` and depends inward. `surface`, `discovery`, `replay`, `control`, `escalation`, `evidence`, `cli`. No module in that list imports another one's internals, only its public entry point.

Dependency direction is strictly inward toward `core`. If you need `core` to know about Playwright, the abstraction is wrong.

## 3. The central seam, SurfaceDriver

This is the most important interface in the repository. It is the seam between *how we perceive and act on a surface* and *the recorded flow*. Get this right and a desktop surface is a new implementation rather than a rewrite.

```ts
export interface SurfaceDriver {
  readonly kind: SurfaceKind;              // 'web' | 'legacy-web' | 'desktop'
  readonly sessionId: SessionId;

  observe(opts?: ObserveOptions): Promise<Observation>;
  match(strategy: LocatorStrategy, framePath: string[]): Promise<string[]>;   // the port the core resolver calls
  frameUrl(framePath: string[]): Promise<string | null>;                   // live url with no snapshot, for policy
  act(action: ResolvedAction, control: ControlToken): Promise<ActionResult>;
  resolve(bundle: LocatorBundle, control: ControlToken): Promise<Resolution>;
  capture(kind: EvidenceKind): Promise<EvidenceRef>;
  close(): Promise<void>;
}
```

`Observation` is surface agnostic. It is a pruned accessibility tree of `UINode` values, each carrying a role, an accessible name, a value, an enabled and visible flag, a frame path, and a per snapshot `ref`. There is no raw platform handle on the node. The driver resolves a ref to its live element, which keeps every `UINode` serialisable.

Two fields on that node are there because of what the target app does to us. `derivedLabel` carries the nearest text by layout, because a form input whose label is a sibling table cell has no accessible name at all. `box` carries viewport geometry, because a relation such as "the input in the same row as this text" should not depend on whether Chromium decides a layout table is a table. It decided yes on the spike page, and that decision is a heuristic other markup can flip. Geometry is used for relations between nodes and never as an absolute coordinate to click. This is ADR 0012.

```ts
interface UINode {
  ref: string;              // 'n17', stable within one snapshot only
  role: string;             // ARIA or platform role, normalised
  name: string;             // accessible name
  value?: string;
  state: { disabled: boolean; visible: boolean; focused: boolean; checked?: boolean };
  framePath: string[];      // [] for top document, then frame names
  derivedLabel?: string;    // nearest text by layout, when the accessible name is empty
  box: Box;                 // viewport geometry, for relations only, never for clicking
  clickableHint: boolean;   // a pointer cursor on a node with no interactive role
  children: UINode[];
}
```

The action vocabulary is deliberately small and surface neutral.

`navigate`, `click`, `fill`, `select`, `press`, `hover`, `scroll`, `waitFor`, `extract`, `assert`, `dismiss`.

A desktop driver implements the same eleven verbs against UI Automation on Windows or AX on macOS. There is no browser concept anywhere in the vocabulary. `navigate` on desktop means open a window or a menu path.

Three implementations.

* `WebSurfaceDriver`. Playwright, Chromium. Accessibility tree first, enriched with geometry and derived labels, DOM as a secondary signal for locator derivation, screenshots for evidence only.
* `FakeSurfaceDriver`. In memory tree, scripted state transitions, no browser. This is what makes the replay executor, the agent loop, and the control plane unit testable at speed.
* `DesktopSurfaceDriver`. Implements the interface, throws `NotImplementedError` with a documented mapping table from each verb to its UI Automation equivalent. It exists to prove the seam is real.

`tests/contract/surfaceDriver.contract.ts` is a single suite parameterised over driver factories. `WebSurfaceDriver` and `FakeSurfaceDriver` must both pass it. That suite is the definition of the seam.

## 4. Perception strategy and why accessibility first

The brief says to bias toward an approach that still works when there is no clean DOM. Three candidate perception strategies.

* **Raw DOM plus CSS selectors.** Fails the brief. Legacy enterprise apps have no test IDs, nested table layouts, generated IDs, and framesets. Selectors derived from that markup are the brittleness the brief is warning about.
* **Screenshot plus coordinates.** Works on anything including desktop, but coordinates are the least stable thing in existence and it makes replay dependent on viewport, zoom, and font rendering. It also burns tokens.
* **Accessibility tree.** Available in browsers and in operating systems, semantically meaningful, tolerant of markup churn, compact enough to put in a prompt, and it is the same abstraction on a desktop app. It degrades on genuinely awful markup, which is why it is the primary signal and not the only one.

Decision. The accessibility tree is primary, enriched with geometry and derived labels at observation time. DOM attributes are captured at record time as additional locator candidates. Screenshots are captured for evidence. They are not a locator strategy, because nothing would ever execute one and a strategy nothing executes is a guess.

This is ADR 0012, which supersedes ADR 0003. Whether it survives the target surface is decided by the spike at S0-T03 before anything is built on it.

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
  | { kind: 'role-name'; role: string; name: TemplateExpr; exact: boolean; confidence: number }
  | { kind: 'test-id'; attr: string; value: string; confidence: number }
  | { kind: 'label'; text: TemplateExpr; confidence: number }
  | { kind: 'text'; text: TemplateExpr; exact: boolean; confidence: number }
  | { kind: 'anchor-relative'; anchor: AnchorStrategy; relation: Relation; role?: string; confidence: number }
  | { kind: 'structural'; path: string; confidence: number };

// Relation is geometric. sameRow, rightOf, below, firstBelow, computed from boxes.
// AnchorStrategy is role-name, label or text. An anchor is a landmark and is never
// itself relative, which keeps a bundle flat and resolution non recursive.
// Text bearing fields are TemplateExpr, so a member ID in a locator is parameterised
// rather than committed as a literal.
```

`anchor-relative` is the strategy that carries legacy surfaces. It targets an element by its spatial relationship to a stable nearby landmark, for example "the input in the same row as the text Savings" or "the first textbox below the heading Member Search". The relation is computed from bounding boxes, not from markup or table roles, because whether Chromium exposes a layout table as a table is a heuristic. Geometry also maps directly onto desktop accessibility, where UI Automation exposes a bounding rectangle for every element.

Resolution at replay tries strategies in order and stops at the first that resolves under the match policy. Three rules that matter.

1. **Ambiguity is a failure, not a coin flip.** If `matchPolicy` is `unique` and a strategy matches more than one node, that strategy is rejected and we move to the next. If every strategy is ambiguous the step fails with `LocatorAmbiguous`. Silently taking the first match is how automation clicks the wrong account.
2. **Degradation is recorded.** If the primary strategy failed and a lower ranked one succeeded, that is a `DriftRecord` on the result and a line in evidence. Working is not the same as healthy. Aggregating those records across runs into a managed signal is designed and not built, see section 9.
3. **A bundle only contains strategies that were observed to work.** Each derived strategy is resolved against the live observation at record time, and one that does not uniquely hit the recorded element is dropped rather than ranked low. Without that, a bundle accumulates strategies that never worked, every replay records a degradation, and the drift signal becomes noise that nobody reads.

Locator bundles are derived by the recorder from the real element at action time. The model chooses an element by `ref`. It never authors a selector, and it is never given a tool that takes one, which is why its tool surface is deliberately narrower than the driver vocabulary. Any derived text that matches a declared input value is emitted as a template, so a member ID never reaches a committed artifact as a literal. This is ADR 0013, and it is the single highest leverage robustness decision in the system.

## 6. Discovery pipeline

```
AgentLoop -> RunTrace -> Generalizer -> Capability
```

`RunTrace` is the raw truth. Every observation hash, every model tool call, every authorisation decision, every action result, every screenshot reference, and the redacted neighbourhood of each element acted on. It is evidence, not a deliverable artifact.

`Generalizer` is a deterministic, unit testable, pure function from `RunTrace` to `Capability`. It does five things.

1. **Prune.** Drop failed attempts, corrective navigations, and actions that did not change the observation hash.
2. **Parameterise.** Replace literal values that match a declared input with `{{inputs.memberId}}` templates, in step values and in locator text. Values from a `pii` or `secret` input are always templated, never stored.
3. **Canonicalise.** Replace input values inside navigate paths and URL patterns, so `/member/10001` becomes `/member/{{inputs.memberId}}`. This is a correctness rule, not a portability nicety. A recorded path that kept the literal would send a replay for any other member to the wrong member's record. The writer's refusal scan would reject such an artifact before that could happen, which means discovery would fail instead.
4. **Infer checkpoints.** For each step, the observation that followed it provides the condition that the step worked. A URL match is never emitted on its own, because in a frameset the URL often does not change when the state does.
5. **Type outputs.** Every `extract` call the model made becomes a typed output with its own locator bundle and a parse rule.

There is no separate wait inference. Every wait is the step postcondition raced against the detectors, so a transform producing waits would duplicate checkpoint inference.

The model calling `done` is not success. The generalizer synthesizes a success condition from the final observation and re asserts it against that same observation. If it does not hold, the run did not succeed, which also catches a model declaring victory on the wrong screen.

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

1. No model is constructed on this path. The dependency is not injected, so it cannot be called by accident. A unit test asserts that the replay module's import graph contains no model client.
2. Locators come from the artifact, resolved deterministically in priority order.
3. Waits are condition based with bounded timeouts. The only sanctioned delay anywhere in the system is `Clock.delay`, which exists for retry backoff, is injected, and is fake in tests. A grep for raw timers runs before submission.
4. Retries are bounded and only permitted for steps declared `idempotent`, which is a separate property from `effect`. A `fill` is retried. A search submit is a read that is not idempotent, so it is not retried, and a submit that may have already posted is never repeated. See ADR 0014.
5. Every acting step asserts a postcondition. We never assume a click worked.

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

The process topology is part of this design, not an afterthought. A run hosts the operator API on :4020 for its own lifetime, blocks in `pending_human` when it escalates, and prints the intervention URL to stdout. Running the executor in one process and the operator API in another would leave the operator with no route to the live page, which is the shortcut that turns this requirement into a demonstration of nothing. See ADR 0016.

## 9. Multitenant model, designed and not built

The brief allows requirement 3.7 to be answered by design, and that is how it is answered here. Nothing in this section is implemented except the drift records it builds on.

A capability would be stored as a base plus sparse overlays.

```
capabilities/
  member.readSavingsBalance@1.2.0.json          the base, the only kind that exists today
  member.readSavingsBalance/variants/
    vendorX-v9@1.0.0.json                       sparse overrides keyed by step id
    tenant-acme@1.0.0.json                      narrower still, extends vendorX-v9
```

Resolution would be `base <- vendorVariant <- tenantVariant`, applied as a typed merge that distinguishes bindings from contracts. An overlay may override a binding. `steps[].target`, `steps[].value`, `outputs[].source`, `outcomes[].detect`, and it may add `onCondition` rules. It may not change a contract. Output name, type, sensitivity or required, the input specs, the step ids or the step order. Forbidding output overrides entirely would block the most common tenant difference there is, a value rendered in a different place. Every overlay declares `appliesTo`, a semver range over base versions, so a base that has moved on refuses to merge rather than merging wrongly. The schema is in `docs/ARTIFACT_SCHEMA.md` section 5, and the decision is ADR 0015.

Drift is half built. Replay already records a `DriftRecord` whenever a lower ranked locator strategy wins, and the `relabel` fault proves it. The management half is designed. Each checkpoint would carry a `surfaceFingerprint`, a hash of the accessibility skeleton with text excluded, and a mismatch would mark that variant for review in a state file beside the artifact, never inside it, because an artifact is an immutable versioned file. That is the cheap, honest answer to per tenant drift across thousands of app instances.

We do not build tenant plumbing, a second tenant, or the overlay merge.

## 10. What is stubbed, and where the seam is

Every stub is deliberate and sits on an interface that a real implementation would satisfy without changing callers.

| Stubbed | Seam | Why this is honest |
| --- | --- | --- |
| Desktop surface | `SurfaceDriver` | Interface implemented, verb to UI Automation mapping documented, contract suite would run against it |
| Operator page | HTTP API with a polled screenshot endpoint | The API is real and integration tested. Only the HTML is bare |
| Multitenant overlays | Overlay schema and ADR 0015 | Specified and not implemented. The base artifact is already the unit an overlay would apply to |
| Capability storage | `CapabilityStore` interface, filesystem implementation | Swapping to Postgres or S3 is one class |
| Auth to the target app | `SessionBroker` logs in before a session is leased | No capability step ever holds a credential, so no artifact can leak one. Real credential handling is an identity problem, not this project problem |
| Approval workflow | `npm run review` writes `status`, `approvedBy` and `approvedAt` | The gate is real and the approval is a commit, so who approved what is answerable from git history |
| Intervention storage | `InterventionStore` interface, in memory | A process restart loses open claims and keeps all evidence. Named honestly in `docs/ESCALATION.md` section 9 |

## 11. Key trade offs, stated plainly

* **Building a local target app instead of using a public demo site.** More upfront work. In exchange we get hermetic tests, the ability to inject the exact runtime error states the brief asks for, and a genuinely hostile legacy surface. Public demo sites cannot give us an injectable permission denial or an unexpected dialog.
* **Accessibility tree over screenshots.** Cheaper, more stable, and portable to desktop. It costs us on canvas heavy or badly authored surfaces, and there is no visual fallback for those.
* **Single process over services.** The brief explicitly discourages scaling infrastructure. Boundaries are interfaces, not network hops. Any of them could become a service without changing callers.
* **Sparse overlays over per tenant artifacts, as a design.** A merge that has to know which fields are contract and which are binding. It avoids the rebuild per tenant problem the brief calls out and keeps one reviewable definition of what the capability does. Not built, so the cost is paid on paper only.
* **Geometry as a first class part of perception.** It costs a bounding box on every node and a rule that geometry is never used to click. It buys relations that do not depend on how Chromium classifies a layout table, and it is the same abstraction UI Automation offers on desktop.
* **Confirm writes rather than block them.** Blocking makes the system useless, since opening a sub account is both a write and one of the brief's own example goals. Reusing the escalation channel for confirmation means one control transfer mechanism instead of two.
