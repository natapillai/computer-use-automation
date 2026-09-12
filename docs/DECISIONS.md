# Architecture decision records

Decisions already made. Do not re litigate these without writing a superseding ADR. Every new decision that is not already covered here gets an entry before the code lands.

Format is deliberately short. Context, decision, consequences, alternatives rejected. If an ADR runs past a page it is two decisions.

---

## ADR 0001. TypeScript, Node, Playwright, Zod, Vitest

**Status.** Superseded by ADR 0011.

**Context.** The stack has to support strong typing of a schema that is also validated at runtime, browser automation with accessibility tree access, a fast test loop, and one language across the automation, the target fixture, and the operator console.

**Decision.** TypeScript strict on Node 20. Zod as the single schema source with types inferred and JSON Schema generated. Playwright for the web driver. Vitest for tests. Fastify for the two small HTTP surfaces.

**Consequences.** One language everywhere. Zod gives us parse time safety for artifacts arriving from disk, which matters because an artifact is untrusted input. Playwright gives accessibility snapshots, frame handling, and CDP access, and the CDP access is what makes the live session handoff possible at all.

**Rejected.** Python with Playwright, which is equally capable but would mean a second language for the target app and the console. Selenium, which has weaker frame and accessibility ergonomics. A CUA agent SDK, which would hide exactly the loop the brief wants to see us design.

---

## ADR 0002. Build a local target application rather than using a public demo site

**Status.** Accepted.

**Context.** The brief permits a public demo site, a local app, or an intentionally hostile surface. Requirement 3.3 needs session timeouts, permission denials, transient failures, and unexpected dialogs, on demand. Requirement 3.7 needs two variants of the same vendor product.

**Decision.** Build MERIDIAN Core, a local frameset based servicing console with fault injection and two tenant variants. See `docs/TARGET_APP.md`.

**Consequences.** Two to three days of work on something that is not the deliverable, and the eleven faults are where that estimate goes if it goes. In exchange, every error path in the taxonomy becomes testable, the integration suite is hermetic and offline, cross tenant reuse becomes demonstrable rather than merely described, and there is no terms of service exposure. The risk is scope creep on the fixture, mitigated by the constraints in `docs/TARGET_APP.md` section 8.

**Rejected.** A public demo site, which cannot inject a session timeout or a permission denial and cannot be cloned into a second tenant variant. A trivial mock, which would not exercise frames, table layouts, or non semantic controls and would make the locator strategy look better than it is.

---

## ADR 0003. Accessibility tree as the primary perception surface

**Status.** Superseded by ADR 0012.

**Context.** The brief says to bias toward an approach that still works when the surface has no clean DOM, because that is the common case. Candidates were DOM plus CSS selectors, screenshot plus coordinates, and the accessibility tree.

**Decision.** Accessibility tree first. DOM attributes and geometry captured at record time as additional locator candidates. Screenshots for evidence and as a last resort locator strategy, flagged low confidence and never used unattended.

**Consequences.** The same abstraction exists on desktop through UI Automation and AX, so the desktop extension story is real rather than hopeful. Observations are compact enough to prompt with. The tree degrades on badly authored markup such as a `<td onclick>` with no role, which is why the fallback ladder exists and why the target app deliberately contains one.

**Rejected.** DOM plus CSS selectors, which is precisely the brittleness the brief warns about in legacy apps. Screenshots plus coordinates, which are the least stable thing available, depend on viewport and font rendering, and are expensive in tokens.

---

## ADR 0004. Locators are derived from the element, never authored by the model

**Status.** Superseded by ADR 0013.

**Context.** A natural design has the model emit a selector. That makes the artifact's robustness a function of a model's guess about markup it saw once.

**Decision.** The model selects an element by an opaque per snapshot `ref`. The recorder derives a full `LocatorBundle` from the real element at action time, with multiple independent strategies ranked by confidence.

**Consequences.** Locator quality becomes a deterministic, unit testable property of our recorder rather than a property of model output. Locator quality can be improved retroactively by re running derivation over a stored trace. The model cannot inject a selector that reaches outside what it was shown.

**Rejected.** Model authored selectors, for the reasons above. A single locator per step, which gives no fallback and turns any drift into a hard failure.

---

## ADR 0005. Business outcomes are declared in the artifact, not inferred at runtime

**Status.** Accepted. Extended by ADR 0018.

**Context.** The brief's glossary names conflating a legitimate business result with a failure as the most common design mistake. Something has to decide which is which.

**Decision.** `capability.outcomes` is a first class array of declared, typed, detectable outcomes with codes. Anything that is neither a declared outcome nor a recoverable condition is a failure by definition.

**Consequences.** The taxonomy is closed, so new real world conditions must be added deliberately rather than swallowed by a catch all. The calling agent branches on stable codes instead of parsing error strings. The cost is that an undeclared but legitimate outcome surfaces as a failure the first time it occurs, which is the correct and safe direction for the mistake to run.

**Rejected.** Runtime heuristic classification such as treating any page containing the word error as a business outcome, which is unpredictable and unreviewable.

---

## ADR 0006. Confirm irreversible actions rather than block them

**Status.** Superseded by ADR 0014.

**Context.** Requirement 3.4 asks us to handle risky and irreversible actions conservatively, and to justify the choice between block, confirm, and flag.

**Decision.** Irreversible actions require human confirmation through the escalation channel. Once a capability is reviewed and approved, and declares `allowUnattendedReplay`, the confirmation moves to review time and replays run unattended.

**Consequences.** The system can perform the write flows that are the entire point, since opening a sub account is both irreversible and one of the brief's own example goals. One control transfer mechanism serves both stuck and confirm. The approving human sees the live screen and the step intent rather than a log line. The residual risk is that approval at review time is a one time decision covering many future runs, which is mitigated by drift detection and the consecutive failure counter.

**Rejected.** Blocking outright, which makes the system a read only scraper and pushes the work back to a human with no audit trail and no capability produced. Flagging only, which is not a control.

---

## ADR 0007. Sparse overlays for multitenant reuse

**Status.** Superseded by ADR 0015.

**Context.** Hundreds of tenants, roughly twenty apps each, many running the same vendor product configured differently. Re recording per tenant does not scale and is explicitly called out in the brief.

**Decision.** One base artifact plus sparse overlays keyed by variant. Resolution is base, then vendor variant, then tenant variant. Overlays may override locators, values, base URL, and outcomes. They may not override inputs, outputs, or the step structure.

**Consequences.** One reviewable definition of what the capability does, with tenant specifics isolated to the things that actually differ. A tenant needing a different contract is correctly forced to be a different capability rather than a silently divergent overlay. Loading is slightly more complex, and the merge is a typed deep merge with its own tests.

**Rejected.** A full artifact per tenant, which is the rebuild per tenant problem. Conditional logic inside one artifact, which destroys reviewability and turns the schema into a programming language.

---

## ADR 0008. Control tokens enforced at the driver, not by convention

**Status.** Accepted.

**Context.** Automation and a human share one live session. Something has to guarantee they never act simultaneously.

**Decision.** `SurfaceDriver.act()` takes a `ControlToken` as a required argument. `ControlPlane` issues exactly one valid token per session and rotates it on every transition. A stale token throws `ControlLostError` before the page is touched.

**Consequences.** A race is structurally impossible rather than unlikely. Token rotation forces automation to re observe after a handback, which is correct, because a human may have changed anything. The type system makes it impossible to call `act` without answering the question of who holds control.

**Rejected.** A boolean flag checked by callers, which is a convention and will be forgotten. A lock held by the session broker, which does not force the caller to re observe after regaining control.

**Amendment, 2026-09-11.** The operator input path never passes through `act()`, so it carries the same fencing explicitly. `POST /sessions/:id/input` requires the current human token. A `context.route` handler also refuses any request to an origin or path outside the allowlist, which is the only control that applies during the human window as well as the automation window.

---

## ADR 0009. Replay is built before discovery

**Status.** Accepted.

**Context.** Discovery produces artifacts. Replay consumes them. Either can be built first.

**Decision.** Build replay first against a hand authored fixture artifact, then build discovery to produce that shape.

**Consequences.** The schema is validated by something that actually executes it before a generalizer starts emitting it, so schema mistakes are found in Phase 5 rather than Phase 8. Discovery has a concrete target. The cost is that the fixture artifact has to be written by hand, which is a few hours and is useful as a test fixture permanently.

**Rejected.** Discovery first, which risks building a generalizer that emits a schema nothing has ever run.

**Amendment, 2026-09-11.** Replay first answers schema risk. It does not answer perception risk, which is larger on this surface, so a throwaway live model spike runs in Slice 2 against the real target before discovery is built. See ADR 0012.

---

## ADR 0010. Single process, filesystem storage, no database

**Status.** Superseded by ADR 0016.

**Context.** The brief explicitly does not reward scaling infrastructure and warns against building it prematurely.

**Decision.** One process. Artifacts and evidence on the filesystem, committed to git. Interventions in memory with a filesystem journal. Boundaries are interfaces, not network hops.

**Consequences.** Trivially runnable by a reviewer, which is itself graded. Git gives artifacts history, diffs, and pull request review, which is the right review surface for something a compliance team reads. `CapabilityStore` and `InterventionStore` are interfaces, so a real deployment swaps one class each. The limit is that a process restart loses intervention claims, which is named honestly in `docs/ESCALATION.md` section 9.

**Rejected.** Postgres, a queue, or a worker pool, all of which the brief says are not rewarded and none of which this scale needs.

---

## ADR 0011. Node 22 LTS, Fastify for our services, Express for the fixture

**Status.** Accepted. Supersedes ADR 0001.

**Context.** ADR 0001 pinned Node 20, which reached end of life on 30 April 2026. It also named Fastify for our HTTP surfaces while `docs/TARGET_APP.md` uses Express, with no reason recorded, and the worked example pinned a model ID inside a document.

**Decision.** Node 22 LTS. Fastify for the operator API and the catalog. Express plus EJS stays for `apps/target`, deliberately, because the fixture emulates a server rendered legacy stack and should not look like the code under test. The model ID is configuration, read from `ANTHROPIC_MODEL`, with the current default in `.env.example` and never in prose.

**Consequences.** A supported runtime through April 2027. Two HTTP frameworks live in the repository, which is only defensible because one of them is the fixture and the split is now written down and repeated in `README.md`. Changing model is a config change with no code touched, and `provenance.model` records what actually ran.

**Rejected.** Node 20, end of life. Fastify for the fixture too, which works but loses the signal that the target is a legacy stack. Express for our own services, which has weaker schema integration than Fastify with Zod.

---

## ADR 0012. Perception is the accessibility tree plus geometry plus derived labels

**Status.** Accepted. Supersedes ADR 0003.

**Context.** ADR 0003 chose the accessibility tree and treated the DOM as a source of extra locator candidates. The target app is built so that is not enough. Labels are `<td>` siblings rather than `<label for>`, so form inputs have no accessible name, and Chromium treats nested layout tables as presentational, so the row structure that `anchor-relative` depends on is not reliably present in the ARIA view. ADR 0003 also never named the extraction mechanism, which is the highest risk integration in the project.

**Decision.** An `Observation` is the accessibility tree, plus a bounding box on every node, plus a `derivedLabel` computed from the nearest text by layout when the accessible name is empty. Spatial relations such as "the input in the same row as this text" are computed from geometry, not from markup. The extraction mechanism is settled by a timeboxed spike, task S0-T04. If the installed Playwright exposes aria-ref locator resolution, refs map back to handles through it. If not, the driver uses CDP `Accessibility.getFullAXTree` per frame and resolves `backendDOMNodeId` through `DOM.resolveNode`. The spike result is recorded as an amendment to this ADR before any Slice 1 surface task starts.

**Consequences.** `UINode` carries geometry, which is what makes the locator model portable, because UI Automation exposes bounding rectangles too. Derived labels mean the model sees a textbox next to the text "Member ID" instead of an anonymous field, which is the difference between a discovery run that works and one that guesses. The cost is that geometry is viewport dependent, so it is only ever used for relations between nodes and never as an absolute coordinate to click.

**Rejected.** The ARIA snapshot alone, which loses both names and rows on exactly this surface. DOM plus CSS selectors, which is the brittleness the brief warns about. Screenshot plus coordinates, which is viewport dependent, expensive in tokens, and does not survive a font change.

---

## ADR 0013. Locator derivation is verified at record time and carries no PII

**Status.** Accepted. Supersedes ADR 0004.

**Context.** ADR 0004 established that locators are derived from the real element and never authored by the model, which is right. Three things under it were wrong. It claimed bundles could be improved retroactively by re running derivation over a stored trace, which the capture policy makes impossible because a successful step stores only a hash. It said nothing about a derived strategy that encodes a member's name or ID, which is a PII leak into a committed artifact. And it implied a `visual` strategy that nothing in the plan executes.

**Decision.**

* The model's tool surface is refs only. It receives no locator and authors no condition. Waits and checkpoints are inferred by the generalizer from observed state transitions.
* Every derived strategy is verified at record time by resolving it against the live observation. A strategy that does not uniquely resolve to the recorded element is dropped, not ranked low.
* Strategy text fields are `TemplateExpr`. Text matching a declared input value is parameterised. Text that trips the redactor and cannot be parameterised causes the strategy to be dropped.
* The trace stores the acted element's redacted neighbourhood, so re derivation is a real capability rather than a claim.
* The `visual` strategy is cut from the union.

**Consequences.** A bundle contains only strategies observed to work at least once, which is what makes a degradation signal meaningful rather than noise. Cutting `visual` removes the only strategy nothing would ever execute, which is the same reasoning that put replay before discovery. The cost is one extra resolve pass per recorded action, paid once during discovery and never during replay.

**Rejected.** Ranking unverified strategies low instead of dropping them, which produces a permanent false drift signal. Keeping `visual` in the schema for the report, which is a schema nothing executes.

---

## ADR 0014. Risk is two independent properties, classified by the app profile

**Status.** Accepted. Supersedes ADR 0006.

**Context.** ADR 0006 chose confirmation over blocking for risky actions, which stands. What sat underneath it did not. A single `risk` enum drove both retry policy and confirmation, and the allowlist classified risk from the HTTP method plus a global regex over button text. `POST /servicing/search` is a read, so the primary read capability classified as irreversible. That forced confirmation during discovery and during every draft replay, and it made the transient retry row unreachable, because the schema forbids retrying an irreversible step.

**Decision.**

* A step carries two properties. `effect` is `read` or `write` and drives confirmation. `idempotent` is a boolean and drives retry. A search POST is a read that is not idempotent, which is a state the old enum could not express.
* Classification comes from the app profile as a route plus method table, not from a global regex over accessible names. The global allowlist still caps what is permitted, and a denial still beats a permission.
* A `confirm` verdict is resolved by a one shot approval grant bound to the run id, the step id and the resolved target. `PolicyEngine` accepts each grant exactly once. Without this the resumed step re authorizes, gets `confirm` again, and escalates forever.

**Consequences.** Product knowledge lives once per vendor product instead of once per capability, which is the same argument that justifies app profiles for conditions. An action with no profile entry defaults to `write` and not idempotent, so an unclassified action fails closed. The cost is one more authored file per application, and a wrong profile is a safety defect, so it is schema validated and tested like code.

**Rejected.** HTTP method as a proxy for irreversibility, which is the defect this ADR exists to fix. A global name regex over button text, which is the same defect relocated. Blocking outright, already rejected in ADR 0006 and still rejected.

---

## ADR 0015. Overlays override bindings, never contracts

**Status.** Accepted. Supersedes ADR 0007.

**Context.** ADR 0007 said an overlay may not override inputs or outputs. The most common difference between two tenants on the same vendor product is a value rendered somewhere else, which is an output binding, so the rule forbade the one thing overlays exist for. The borealis variant moves the savings balance to a different column and would have been unfixable by overlay. Overlays also had no declared relationship to the base version and no way to express a tenant only interstitial.

**Decision.** An overlay may override any binding. `steps[].target`, `steps[].value`, `outputs[].source`, `outcomes[].detect`, `app.baseUrl`, and it may add `onCondition` rules and mark an existing step `optional`. An overlay may not change any contract. Output `name`, `type`, `sensitivity` and `required`, the input specs, the step ids, or the step order. Every overlay declares `appliesTo`, a semver range over base versions, and may declare `extends` naming its parent overlay.

**Consequences.** The borealis balance column and its post login interstitial are both expressible without re recording. A base version outside the declared range refuses to load rather than merging into a shape the overlay was never written against. A tenant that genuinely needs a different contract is still forced to become a different capability, which was the correct half of ADR 0007. The cost is that the merge distinguishes contract from binding field by field, so it is a typed merge with its own tests rather than a deep spread.

**Rejected.** Forbidding output overrides, which breaks the demonstration it was meant to protect. A full artifact per tenant, which is the rebuild per tenant problem. Conditionals inside one artifact, which destroys reviewability.

---

## ADR 0016. The run process hosts the operator API

**Status.** Accepted. Supersedes ADR 0010.

**Context.** ADR 0010 said single process and filesystem storage, which is right for this scale. The command set contradicted it. `discover` and `replay` are their own processes and the session broker owns the browser inside them, so an operator API started by `serve` had no route to the live page. Escalation is the requirement the brief says candidates fake, and this topology would have made it unimplementable. The intervention journal also outlived the thing it described.

**Decision.**

* A run hosts the operator API and the console on :4020 for its own lifetime. `serve` is the same server with no run attached, used for the catalog and for reading past interventions.
* On escalation the run blocks in `pending_human` and prints the intervention URL to stdout, so the handoff is demonstrable from the terminal rather than merely present in the code.
* `escalated` is a terminal result only when the intervention is unclaimed at timeout or is aborted. A claimed and released intervention resumes and the run reports its real outcome.
* Every result carries `interventions[]` alongside `recoveries[]`. A success that needed a human is not a clean success, and hiding that is how an unreliable capability looks healthy.
* `resumeToken` is removed. There is nothing outside the process to resume from.
* The filesystem intervention journal is removed. A restored intervention would point at a browser that died with the process. Evidence is the durable audit trail.

**Consequences.** The handoff runs in one process with no IPC and no shared state protocol, and `MockOperator` exercises the same server a human uses. A crashed run loses its pending intervention, which is the honest limit of a single process filesystem design and goes in `REPORT.md`. The cost is that :4020 belongs to whichever run holds it.

**Rejected.** `serve` as the only runtime with the CLIs as HTTP clients, which is defensible and adds a client server hop to every demo command a reviewer types. A second process attaching over CDP, which splits control state across processes and reintroduces the race ADR 0008 removed.

---

## ADR 0017. Cassette matching is by position with a shape assertion

**Status.** Accepted.

**Context.** The E2E test replays a recorded model transcript so the full discovery thread runs offline. Matching a recorded response by hashing the request breaks on any prompt edit and forces a paid live re record. Matching purely by position makes the test blind to a regression in what the model is shown.

**Decision.** A cassette is an ordered list of exchanges. The client returns exchange N for the Nth call and asserts two things about the request. The tool set matches what was recorded, and the observation's `a11yHash` matches what was recorded. A mismatch fails with a diff instead of replaying the wrong turn. Refs are assigned in document order and the target app seeds its generated IDs per process, so the hash is stable across runs.

**Consequences.** Prompt wording, system prompt structure and rationale text can change without a re record, which is where most edits land. A change to the pruned observation fails loudly, which is the regression actually worth catching. The cost is that a deliberate change to the observation needs a live re record with a real key, which is the same cost as accepting a snapshot update.

**Rejected.** Request hash matching, which makes every prompt edit cost money. Pure positional matching, which cannot fail and therefore proves nothing.

---

## ADR 0018. Business outcomes are captured by negative probe, not invented

**Status.** Accepted. Extends ADR 0005.

**Context.** ADR 0005 requires that outcomes are declared in the artifact rather than inferred at runtime. Nothing said how they get there. A single happy path discovery run never observes "No records found", so a discovered artifact declares no outcomes, and its first replay with an unknown member returns a failure. That is the exact mistake the brief's glossary names, and under the original plan it would have appeared in the committed evidence.

**Decision.** After discovery, the draft is replayed with a negative probe input. The run stops where the postcondition fails and captures that observation. A reviewer names the outcome code, the recorder derives the detector bundle from the real element on that screen, and the outcome lands as a minor version bump with `provenance: 'manual'`. Discovery emits `1.0.0`, review emits `1.1.0`, and both are committed to evidence with the diff between them.

**Consequences.** Outcome detectors are derived from a real element like every other locator, so ADR 0013 holds for them too and nobody hand writes a selector. The evidence shows a review step rather than a hand authored artifact appearing from nowhere, which is a better answer to "is this thread real" than a fixture is. The hand authored fixture still exists, but only as a test fixture for the replay executor, and `README.md` says so. The cost is a second run per outcome and a human naming the code, which is correct, because naming a business outcome is a product decision and not something to infer from page text.

**Rejected.** Inferring outcomes from page text at replay time, already rejected by ADR 0005 and still unreviewable. Hand authoring the fixture and presenting it as the discovered artifact, which breaks the thread the brief asks for.

---

## Template for new ADRs

```
## ADR NNNN. Short imperative title

**Status.** Proposed | Accepted | Superseded by ADR NNNN.

**Context.** What forced a decision. Two or three sentences.

**Decision.** What we are doing. One or two sentences.

**Consequences.** What this buys and what it costs. Include the cost honestly.

**Rejected.** The alternatives and the specific reason each lost.
```
