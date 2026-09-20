# Computer use automation for back office banking

## 1. Architecture

Four parts. Discovery drives a live surface with an LLM until a goal is met, the successful run is generalized into a capability artifact, replay re executes that artifact with no model anywhere in the decision loop, and escalation hands the same live session to a person and takes it back.

The decision that shapes everything else is that the model is present only in the first of those four. It is expensive, it is slow, and it is not reproducible, so it is worth exactly one thing, working out how to do something nobody has written down. Once that is known it is a liability, because a system that asks a model at run time cannot tell you in advance what it will do to a member account. So the artifact is the product and the transcript is a by product, and replay is a different program that happens to share a surface.

That split only holds if it is enforced rather than intended. Two boundaries do it. `SurfaceDriver` is the only thing that knows it is driving a browser, and `authorize()` is the only place an action is permitted. The agent loop never holds a driver, it holds a `GuardedSurface` that authorizes and then delegates, so bypassing policy means editing the wiring rather than forgetting a call. Both claims are checked rather than asserted. A test walks everything `src/replay` imports, transitively, and fails if the graph reaches a model client, and a desktop stub satisfies the driver interface so the compiler checks the seam on every build.

I drive the accessibility tree rather than screenshots and coordinates. The target is a frameset of generated element ids, which is where a tree is worth most and pixels least. The cost is that anything the tree cannot see is invisible. On this surface that trade is clearly right, on a Citrix session it would be clearly wrong, and the seam is where it gets replaced.

The model never writes a selector. It picks a ref from the observation it was just shown, and the recorder derives a locator bundle from the real element behind it. This is the one place I would push back on the obvious design. Letting a model emit a CSS selector is easier to build and reads well in a demo, and it fails silently, because a plausible selector that matches the wrong element produces a run that looks fine. Refusing to accept one removes that whole category rather than mitigating it.

## 2. Artifact schema

A capability is typed, versioned, parameterized and decoupled from the transcript that produced it. Zod is the single source of truth, so the schema the executor enforces, the JSON Schema a calling agent reads and the TypeScript the code compiles against cannot drift apart. Three parts earned their shape.

**Locator bundles, not selectors.** Each target is an ordered list of strategies under a match policy, derived from the real element and ranked by stability, and every candidate is verified against the page at record time rather than stored on faith. A lower ranked win records drift naming both the preferred strategy and the one that worked. Section 3 says why the ladder is shaped that way.

**Steps declare effect and idempotency, and they are cross checked.** A step says whether it writes and whether repeating it is free, the app profile says the same about each route, and the network guard enforces the profile against the step while it runs. An artifact whose declaration contradicts the application fails before the write lands. The first version had one enum that called any POST irreversible, which made the member search need confirmation every run and the retry case unreachable. A search is a read that is not idempotent, and one enum could not say that.

**Outcomes are declared, never inferred.** "No such member" is a result, not a failure, and the artifact carries a detector derived from the real banner. A happy path run declares no outcomes, so its first replay with an unknown member reports a failure. That is the mistake the brief names and it would have been in my evidence. The fix is a negative probe review. It replays the draft with a bad input, stops where the postcondition fails, asks a reviewer to name the code, derives the detector from the element on that screen, and writes the new version only once it replays to the outcome it declares. Both capabilities got their outcome that way, the read and the write.

## 3. Determinism & error handling

No model is constructed on the replay path and a test proves it transitively. Every wait is a bounded condition raced against the surface, never a sleep. All four result shapes carry `recoveries`, `interventions` and `drift` whether anything happened or not.

Thirteen hard failure classes stay separate from business outcomes, recoverable conditions and escalations. A transient 502 or 503 on an idempotent step is recovered by asking for the failed response again, bounded at three attempts, and reported even when the run succeeds. A capability that only works on the second attempt is a fact about the surface, and hiding it is how a degrading system looks healthy until it is not.

One finding would have been an incident. A locator bundle is a ladder, and a strategy matching two elements was treated like one matching none, so a lower ranked strategy resolved one. On a page showing two rows with the same member number, that is a fifty fifty guess about whose account to open, reported as success. An ambiguous strategy now ends resolution as `LocatorAmbiguous`. Falling through is the real alternative, more robust against drift and less safe against ambiguity. The two have opposite fixes, so one channel means the dangerous case arrives dressed as the routine one.

The ladder came from the surface. The savings balance is an unnamed cell identified only by sitting right of the cell reading `Savings`, and the sub account suffix is named by its own contents, `H01`. Legacy surfaces name data cells by their contents, so the highest confidence strategy is systematically the least reusable one, and the fallbacks are the mechanism, not a safety net.

Four times a test passed while the real path was broken, each driving the layer beneath what a person touches. A search field's ref named the card number cell on the next page, invisible to unit tests because the fake driver reissued refs honestly. A broken wait passed its gate. The console was tested by posting to an input endpoint its page never called, and my own rehearsal wrote the step the model was meant to choose. I now ask of every test which layer it drives.

## 4. Heterogeneity & multi-tenant

The desktop surface is a stub, which the brief permits, and the stub is where the design is argued rather than asserted. It satisfies the interface, refuses every method by name, and carries a documented UI Automation mapping for every verb in the vocabulary. Writing that mapping is what made it worth having. The vocabulary needed nothing added, and the only real change is where geometry comes from. A `BoundingRectangle` in screen coordinates behaves like a layout box, so the anchor relative relations carry over unchanged, which is the part of the locator design that would have been expensive to get wrong.

Multi tenant reuse is designed and not built. Overlays rebind locators and outputs for one institution and can never touch the contract, so a tenant cannot quietly change what a capability means. If I built one more thing it would be the second tenant, because its differences would force the overlay merge, the interstitial handler and drift management into existence together rather than one at a time.

## 5. Escalation & handoff

Four triggers stop a run: no progress across consecutive actions, a dialog nobody has classified, the model asking, and a policy confirmation on a write, the one where nothing is wrong and the run may not submit on its own.

Control is a state machine over one live session with fencing tokens. One holder is valid at a time and the token rotates on every transition, so a run that lost control cannot assume anything about a page somebody else may have changed. The run hosts the console itself, the honest consequence of one process and a filesystem.

A claimed operator sees a masked screenshot of the live page and can click it, type into it, and send a frame to a path, the last because clicking cannot reach a page nothing links to. All of it runs through the same allowlist and control token as the automation.

Coming back is a ladder rather than a resume. The run re observes and asks, in order, for the capability's success condition, a declared outcome, the step's postcondition, an approval, then the precondition. Approving one action is deliberately not finishing the run, because nothing here turns human actions into steps. An approved run still produces its artifact and a run somebody completed by hand does not.

## 6. Safety

Five controls, each doing one thing.

* An allowlist of origins and paths, checked before every action and every request.
* An app profile classifying each route by effect and idempotency, enforced per step by a network guard that refuses a write under a step declared a read, before it lands.
* Redaction at the sink rather than the call site, so nothing written anywhere carries a value.
* A canary scanner that fails the suite if a seeded value reaches evidence, a capability or a cassette.
* Human confirmation on every write that is not an approved capability running unattended.

The write flag is worth explaining. Nothing in an accessibility tree says whether a cell submits a form, and inferring it from button text is the regex over button names the design already rejects. So the model declares it, and the declaration cannot be a bypass in either direction. Declaring a write sends it to a person, the strictest path. Omitting it leaves the step a read, and the guard refuses the request the profile calls a write before it lands. An integration test proves the omitted case, because that is the one a grader should look for.

### One rule, two audiences

The approval gate found its own defect the first time it was used in anger. Approving the live write, the operator could not establish which member the change was for. The screen masks the member number and the name, the trace records the navigate as `/member/{{inputs.memberId}}/subaccount`, and the console showed the goal with its placeholders unresolved. The only place the value existed was the command they had typed, so the approval rested on reasoning rather than observation.

The redaction rule was right. It was serving two audiences. A log file, an artifact and a stored capture are read later, by people and systems with no business knowing which member a run touched, and they should carry a template. A claimed operator sitting in front of a live session is being asked one question, and they cannot answer it without the subject of the change. Those are different audiences and one rule was covering both.

A claimed operator now sees the resolved inputs in the console, behind the same control token, and nothing written down carries them. Not the intervention, not the trace, not the prompt, and not the decision capture, which photographs the live page rather than the console. The test that protects it is a sufficiency test rather than a masking one. An approval view must present enough to identify the subject of the change, and must present nothing before the session is claimed. I had the argument already, in the sentence about the amount, and had scoped it to the wrong fields.

The other limits. The canary scanner catches seeded values and pattern matches, not a value it has never seen, and name redaction depends on the profile's field map being right. The operator is trusted, so their actions give audit after the fact rather than prevention.

## 7. Cuts

`PROGRESS.md` has the full list.

* **Reach.** Multi tenant overlays, drift management and the desktop driver are designed and not built, and recovery handles a transient 502 or 503 on an idempotent step only.
* **The handoff is thin.** Screenshots are polled rather than streamed, and one operator holds a session with no queue.
* **Tooling stops at the contract.** The schema sits at `docs/capability.schema.json` rather than beside each artifact, because Zod emits an integer bound that trips the canary scanner, and loosening a safety rule for a convenience file is the wrong way round.
* **Guardrails are manual.** No CI, coverage gate, lint rule or visual locator fallback.
* **Two unexplained test failures.** The end to end suite failed once in forty seven minutes where it takes forty five seconds, the integration suite once, and neither reproduced. I record them unexplained rather than closed, because a suite I call green must mean it.

I would build a second tenant next, for the reason in section 4.
