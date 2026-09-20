# Computer use automation for back office banking

## 1. Architecture

Four parts. Discovery drives a live surface with an LLM until a goal is met, the successful run is generalized into a capability artifact, replay re executes that artifact with no model anywhere in the decision loop, and escalation hands the same live session to a person and takes it back.

The decision that shapes everything else is that the model is present only in the first of those four. It is expensive, it is slow, and it is not reproducible, so it is worth exactly one thing: working out how to do something nobody has written down. Once that is known it is a liability, because a system that asks a model at run time cannot tell you in advance what it will do to a member account. So the artifact is the product and the transcript is a by product, and replay is a different program that happens to share a surface.

That split only holds if it is enforced rather than intended. Two boundaries do it. `SurfaceDriver` is the only thing that knows it is driving a browser, and `authorize()` is the only place an action is permitted. The agent loop never holds a driver, it holds a `GuardedSurface` that authorizes and then delegates, so bypassing policy means editing the wiring rather than forgetting a call. Both claims are checked rather than asserted: a test walks everything `src/replay` imports, transitively, and fails if the graph reaches a model client, and a desktop stub satisfies the driver interface so the compiler checks the seam on every build.

I drive the accessibility tree rather than screenshots and coordinates. The target is a frameset of generated element ids, which is where a tree is worth most and pixels least. The cost is that anything the tree cannot see is invisible. On this surface that trade is clearly right, on a Citrix session it would be clearly wrong, and the seam is where it gets replaced.

The model never writes a selector. It picks a ref from the observation it was just shown, and the recorder derives a locator bundle from the real element behind it. This is the one place I would push back on the obvious design. Letting a model emit a CSS selector is easier to build and reads well in a demo, and it fails silently, because a plausible selector that matches the wrong element produces a run that looks fine. Refusing to accept one removes that whole category rather than mitigating it.

## 2. Artifact schema

A capability is typed, versioned, parameterized and decoupled from the transcript that produced it. Zod is the single source of truth, so the schema the executor enforces, the JSON Schema a calling agent reads and the TypeScript the code compiles against cannot drift apart. Three parts earned their shape.

**Locator bundles, not selectors.** Each target is an ordered list of strategies under a match policy, derived from the real element and ranked by stability, and every candidate is verified against the page at record time rather than stored on faith. A lower ranked win records drift naming both the preferred strategy and the one that worked. Section 3 says why the ladder is shaped that way, because it came from the surface rather than from a design.

**Steps declare effect and idempotency, and they are cross checked.** A step says whether it writes and whether repeating it is free, the app profile says the same about each route, and the network guard enforces the profile against the step while it runs. An artifact whose declaration contradicts the application fails before the write lands. The first version had one enum that called any POST irreversible, which made the member search need confirmation on every run and made the retry case unreachable. A search is a read that is not idempotent, and one enum could not say that.

**Outcomes are declared, never inferred.** "No such member" is a result, not a failure, and the artifact carries a detector derived from the real banner. A happy path discovery run declares no outcomes, so its first replay with an unknown member would report a failure. That is the mistake the brief names and it would have been in my evidence. The fix is a negative probe review: replay the draft with a bad input, stop where the postcondition fails, have a reviewer name the code, derive the detector from the element on that screen, and write the new version only once it replays to the outcome it declares.

## 3. Determinism & error handling

No model is constructed on the replay path and a test proves it. Every wait is a bounded condition raced against the surface, never a sleep, in tests and production alike. The result is one of four shapes, and all four carry `recoveries`, `interventions` and `drift` whether or not anything happened, so a caller never asks which shape it got before knowing whether a field exists.

The taxonomy separates thirteen failure classes from business outcomes, recoverable conditions and escalations. A transient 502 or 503 on an idempotent step is recovered by asking for the failed response again, bounded at three attempts with a doubling backoff, and reported even when the run then succeeds. A capability that only works on the second attempt is a fact about the surface, and hiding it because the run passed is how a degrading system looks healthy until it is not.

### The one that would have been an incident

A locator bundle is a ladder, and until late in the build a strategy that matched two elements was treated like one that matched none: the ladder carried on and a lower ranked strategy resolved one of them. On a search result page showing two rows with the same member number and different records, that is a fifty fifty guess about whose account to open, reported as a success with a drift record. The system passed its own tests while doing the one thing a bank would treat as an incident.

Under a unique match policy, a strategy matching more than one element now ends the resolution as `LocatorAmbiguous`. The rejected alternative is real and I want to name it plainly: falling through is more robust against drift, because a page that has changed shape still gets driven. It is less safe against ambiguity, because a page carrying two candidates gets driven anyway. Drift and ambiguity have opposite fixes, re record for one and record a better locator for the other, and putting both down the same channel means the dangerous one arrives dressed as the routine one. On this surface safety wins.

### Why the ladder looks like that

Two elements in this build had the same shape and they are the reason the ladder exists at all. The savings balance is an unnamed table cell whose only stable property is being to the right of the cell reading `Savings`. The sub account suffix is a cell whose highest confidence strategy is `role-name` naming it by its own contents, `H01`, which can only ever match the run that recorded it. In both cases the accessibility strategy with the best confidence is the least reusable one, and label anchored geometry is what will carry the capability on replay.

That is a property of legacy surfaces rather than an anecdote about one screen. They name data cells by their contents, because the content is the only thing there is to name them by. So a ranking that trusts confidence alone ranks backwards, and the fallbacks are not a safety net, they are the mechanism. What makes this trustworthy rather than hopeful is that the recorder verifies every candidate against the page as it derives it. On the suffix cell it dropped a heading anchored candidate as `missed`, so what reaches the artifact is what was observed to work.

### Three times a test passed while the path was broken

Each was found by driving the layer a person actually touches.

A stale ref. A search field's ref named the card number cell on the next page, because the browser reissues refs on every snapshot, and the unit tests could not see it because the fake driver reissued refs honestly. The driver now re checks role, name and frame path against a fresh snapshot before acting.

A wait that passed its gate while broken. Its own test caught it, which is the only reason it did not ship.

The operator console. The input endpoint, the CDP hit testing and the record it produces were all real and all tested, and the page never called any of them, because every test posted to the endpoint directly. A person could see the live session and not touch it, which is requirement 3.6 not working, and only a live run found it.

The fourth is mine to admit rather than claim. My own rehearsal script wrote the navigate step the model was supposed to choose, so the test supplied the answer to the thing under test. That is the console defect one layer up. It is why the rehearsal is now a real browser on the real console page, and why I now ask of every test which layer it drives.

## 4. Heterogeneity & multi-tenant

The desktop surface is a stub, which the brief permits, and the stub is where the design is argued rather than asserted. It satisfies the interface, refuses every method by name, and carries a documented UI Automation mapping for every verb in the vocabulary. Writing that mapping is what made it worth having. The vocabulary needed nothing added, and the only real change is where geometry comes from. A `BoundingRectangle` in screen coordinates behaves like a layout box, so the anchor relative relations carry over unchanged, which is the part of the locator design that would have been expensive to get wrong.

Multi tenant reuse is designed and not built. Overlays rebind locators and outputs for one institution and can never touch the contract, so a tenant cannot quietly change what a capability means. If I built one more thing it would be the second tenant, because its differences would force the overlay merge, the interstitial handler and drift management into existence together rather than one at a time.

## 5. Escalation & handoff

Stuck is detected three ways: no progress across consecutive actions, a dialog nobody has classified, and the model asking. A policy confirmation on a write is a fourth, where nothing is wrong and the run simply may not submit on its own.

Control is a state machine over one live session with fencing tokens. Exactly one holder is valid at a time and the token rotates on every transition, so a run that lost control even briefly cannot act on assumptions about a page somebody else may have changed. The run hosts the console itself, which is the honest consequence of one process and a filesystem. An intervention is claimable exactly while the session it points at is alive.

A person claims the session, sees a masked screenshot of the live page, and can click it, type into it and send a frame to a path. The last exists because clicking cannot reach a page nothing links to, and the sub account form is exactly that. It is bounded by the same allowlist every request is, refuses the top window because the frameset is the session, and goes through the same control token.

Coming back is a ladder rather than a resume. The run asks in order whether the capability's success condition now holds, whether a declared outcome does, whether the step's postcondition does, whether the person approved one action, and whether the step's precondition holds. Approving one action is deliberately not the same as finishing the run. An approved run still produces its artifact and a run somebody completed by hand does not, because nothing here turns human actions into steps.

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

A claimed operator now sees the resolved inputs in the console, behind the same control token, and nothing written down carries them. Not the intervention, not the trace, not the prompt, and not the decision capture, which photographs the live page rather than the console. The test that protects it is a sufficiency test rather than a masking one: an approval view must present enough to identify the subject of the change, and must present nothing before the session is claimed. I had the argument already, in the sentence about the amount, and had scoped it to the wrong fields.

The other limits. The canary scanner catches seeded values and pattern matches, not a value it has never seen, and name redaction depends on the profile's field map being right. The operator is trusted, so their actions give audit after the fact rather than prevention.

## 7. Cuts

I built every core requirement as a thin, real mechanism and cut breadth around them. These are the cuts a reviewer is most likely to notice, most important first.

* **Cross tenant reuse and drift management are designed, not built.** Overlays are specified and replay records locator degradation, but there is no second tenant and no overlay merge.
* **Recovery is narrow.** Transient 502 and 503 are retried on idempotent steps and reported even on success. Interstitials, stale elements and session expiry are not recovered.
* **The handoff is real but thin.** A person can click, type and navigate a frame on the live session, and every action is recorded. It polls screenshots rather than streaming, human actions never become draft steps, and there is one operator per session with no queue.
* **Capability tooling stops at the contract.** A tool definition and a review sheet are generated beside every artifact, and the artifact schema itself is generated and committed at `docs/capability.schema.json`, but no catalog serves them and nothing classifies version changes.
* **Guardrails around the code are manual.** No CI, no coverage gate, no lint rule, no visual locator fallback, and the desktop driver is a stub.
* **Two unexplained test failures.** The end to end suite failed once in forty seven minutes where it normally takes forty five seconds, and the integration suite failed once. I could reproduce neither, and I lost the detail on both by piping the output. I bounded the unbounded waits the first could have come from. I record them unexplained rather than closed, because a suite I have called green needs to mean it.
The one thing I would build next is a second tenant of the target app, for the reason in section 4.
