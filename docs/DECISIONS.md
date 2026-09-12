# Architecture decision records

Decisions already made. Do not re litigate these without writing a superseding ADR. Every new decision that is not already covered here gets an entry before the code lands.

Format is deliberately short. Context, decision, consequences, alternatives rejected. If an ADR runs past a page it is two decisions.

---

## ADR 0001. TypeScript, Node, Playwright, Zod, Vitest

**Status.** Accepted.

**Context.** The stack has to support strong typing of a schema that is also validated at runtime, browser automation with accessibility tree access, a fast test loop, and one language across the automation, the target fixture, and the operator console.

**Decision.** TypeScript strict on Node 20. Zod as the single schema source with types inferred and JSON Schema generated. Playwright for the web driver. Vitest for tests. Fastify for the two small HTTP surfaces.

**Consequences.** One language everywhere. Zod gives us parse time safety for artifacts arriving from disk, which matters because an artifact is untrusted input. Playwright gives accessibility snapshots, frame handling, and CDP access, and the CDP access is what makes the live session handoff possible at all.

**Rejected.** Python with Playwright, which is equally capable but would mean a second language for the target app and the console. Selenium, which has weaker frame and accessibility ergonomics. A CUA agent SDK, which would hide exactly the loop the brief wants to see us design.

---

## ADR 0002. Build a local target application rather than using a public demo site

**Status.** Accepted.

**Context.** The brief permits a public demo site, a local app, or an intentionally hostile surface. Requirement 3.3 needs session timeouts, permission denials, transient failures, and unexpected dialogs, on demand. Requirement 3.7 needs two variants of the same vendor product.

**Decision.** Build MERIDIAN Core, a local frameset based servicing console with fault injection and two tenant variants. See `docs/TARGET_APP.md`.

**Consequences.** Roughly a day of work on something that is not the deliverable. In exchange, every error path in the taxonomy becomes testable, the integration suite is hermetic and offline, cross tenant reuse becomes demonstrable rather than merely described, and there is no terms of service exposure. The risk is scope creep on the fixture, mitigated by the constraints in `docs/TARGET_APP.md` section 8.

**Rejected.** A public demo site, which cannot inject a session timeout or a permission denial and cannot be cloned into a second tenant variant. A trivial mock, which would not exercise frames, table layouts, or non semantic controls and would make the locator strategy look better than it is.

---

## ADR 0003. Accessibility tree as the primary perception surface

**Status.** Accepted.

**Context.** The brief says to bias toward an approach that still works when the surface has no clean DOM, because that is the common case. Candidates were DOM plus CSS selectors, screenshot plus coordinates, and the accessibility tree.

**Decision.** Accessibility tree first. DOM attributes and geometry captured at record time as additional locator candidates. Screenshots for evidence and as a last resort locator strategy, flagged low confidence and never used unattended.

**Consequences.** The same abstraction exists on desktop through UI Automation and AX, so the desktop extension story is real rather than hopeful. Observations are compact enough to prompt with. The tree degrades on badly authored markup such as a `<td onclick>` with no role, which is why the fallback ladder exists and why the target app deliberately contains one.

**Rejected.** DOM plus CSS selectors, which is precisely the brittleness the brief warns about in legacy apps. Screenshots plus coordinates, which are the least stable thing available, depend on viewport and font rendering, and are expensive in tokens.

---

## ADR 0004. Locators are derived from the element, never authored by the model

**Status.** Accepted.

**Context.** A natural design has the model emit a selector. That makes the artifact's robustness a function of a model's guess about markup it saw once.

**Decision.** The model selects an element by an opaque per snapshot `ref`. The recorder derives a full `LocatorBundle` from the real element at action time, with multiple independent strategies ranked by confidence.

**Consequences.** Locator quality becomes a deterministic, unit testable property of our recorder rather than a property of model output. Locator quality can be improved retroactively by re running derivation over a stored trace. The model cannot inject a selector that reaches outside what it was shown.

**Rejected.** Model authored selectors, for the reasons above. A single locator per step, which gives no fallback and turns any drift into a hard failure.

---

## ADR 0005. Business outcomes are declared in the artifact, not inferred at runtime

**Status.** Accepted.

**Context.** The brief's glossary names conflating a legitimate business result with a failure as the most common design mistake. Something has to decide which is which.

**Decision.** `capability.outcomes` is a first class array of declared, typed, detectable outcomes with codes. Anything that is neither a declared outcome nor a recoverable condition is a failure by definition.

**Consequences.** The taxonomy is closed, so new real world conditions must be added deliberately rather than swallowed by a catch all. The calling agent branches on stable codes instead of parsing error strings. The cost is that an undeclared but legitimate outcome surfaces as a failure the first time it occurs, which is the correct and safe direction for the mistake to run.

**Rejected.** Runtime heuristic classification such as treating any page containing the word error as a business outcome, which is unpredictable and unreviewable.

---

## ADR 0006. Confirm irreversible actions rather than block them

**Status.** Accepted.

**Context.** Requirement 3.4 asks us to handle risky and irreversible actions conservatively, and to justify the choice between block, confirm, and flag.

**Decision.** Irreversible actions require human confirmation through the escalation channel. Once a capability is reviewed and approved, and declares `allowUnattendedReplay`, the confirmation moves to review time and replays run unattended.

**Consequences.** The system can perform the write flows that are the entire point, since opening a sub account is both irreversible and one of the brief's own example goals. One control transfer mechanism serves both stuck and confirm. The approving human sees the live screen and the step intent rather than a log line. The residual risk is that approval at review time is a one time decision covering many future runs, which is mitigated by drift detection and the consecutive failure counter.

**Rejected.** Blocking outright, which makes the system a read only scraper and pushes the work back to a human with no audit trail and no capability produced. Flagging only, which is not a control.

---

## ADR 0007. Sparse overlays for multitenant reuse

**Status.** Accepted.

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

---

## ADR 0009. Replay is built before discovery

**Status.** Accepted.

**Context.** Discovery produces artifacts. Replay consumes them. Either can be built first.

**Decision.** Build replay first against a hand authored fixture artifact, then build discovery to produce that shape.

**Consequences.** The schema is validated by something that actually executes it before a generalizer starts emitting it, so schema mistakes are found in Phase 5 rather than Phase 8. Discovery has a concrete target. The cost is that the fixture artifact has to be written by hand, which is a few hours and is useful as a test fixture permanently.

**Rejected.** Discovery first, which risks building a generalizer that emits a schema nothing has ever run.

---

## ADR 0010. Single process, filesystem storage, no database

**Status.** Accepted.

**Context.** The brief explicitly does not reward scaling infrastructure and warns against building it prematurely.

**Decision.** One process. Artifacts and evidence on the filesystem, committed to git. Interventions in memory with a filesystem journal. Boundaries are interfaces, not network hops.

**Consequences.** Trivially runnable by a reviewer, which is itself graded. Git gives artifacts history, diffs, and pull request review, which is the right review surface for something a compliance team reads. `CapabilityStore` and `InterventionStore` are interfaces, so a real deployment swaps one class each. The limit is that a process restart loses intervention claims, which is named honestly in `docs/ESCALATION.md` section 9.

**Rejected.** Postgres, a queue, or a worker pool, all of which the brief says are not rewarded and none of which this scale needs.

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
