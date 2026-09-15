# Safety and policy guardrails

This is regulated financial data operated by a non deterministic model. The guardrail model has to assume the model will occasionally try to do something wrong, and make that structurally impossible rather than merely discouraged.

## 1. The single choke point

Every action that reaches a surface passes through one function.

```ts
PolicyEngine.authorize(action: ProposedAction, ctx: PolicyContext): AuthorizationDecision
```

The agent loop does not hold a `SurfaceDriver`. It holds a `GuardedSurface` that wraps the driver and calls `authorize` before delegating. The unguarded driver is not exported from its module. This means bypassing policy requires editing the wiring, not forgetting a call, and a code reviewer looking for policy bypasses has one place to look.

A unit test asserts that `src/discovery` and `src/replay` do not import the raw driver module. Enforcing an architectural rule with a test is cheaper than enforcing it with a convention.

`authorize` has exactly one call site, inside `GuardedSurface`. The executor does not call it separately and then act, it receives the verdict as a typed value from the guarded call. Two call sites would mean two places to audit and two chances to drift, which is not a single choke point however it is described.

Decisions are three valued, never boolean.

```ts
type AuthorizationDecision =
  | { verdict: 'allow' }
  | { verdict: 'deny'; rule: string; reason: string }
  | { verdict: 'confirm'; rule: string; reason: string; effect: 'write' };
```

`confirm` routes into the escalation channel described in `docs/ESCALATION.md`. One control transfer mechanism serves both "I am stuck" and "I need a person to approve this", which is a simplification worth having.

Unknown means deny. If the classifier cannot categorise an action, or the target origin is not matched by any rule, the verdict is `deny`. Fail closed is not a slogan here, it is the default branch of the match.

## 2. The allowlist

`policy/allowlist.yaml`, loaded once, Zod validated at startup, never reloaded mid run.

```yaml
version: 1

origins:
  - pattern: "http://localhost:4010"
    description: "Local MERIDIAN Core target app"
    allowedPaths:
      - "/servicing/**"
      - "/member/**"
      - "/auth/login"
    deniedPaths:
      - "/admin/**"
      - "/__control__/**"
      - "/**/delete"
      - "/**/wire/**"

actions:
  allowed: [navigate, click, fill, select, press, hover, scroll, waitFor, extract, assert, dismiss]
  denied: [upload, download, execScript, newTab, clipboardRead]

# Risk classification is not in this file. It lives in profiles/<appId>.json as a
# route plus method table, because effect and idempotency are properties of an
# application and not of a regex over button text. This file caps what is permitted
# at all. The profile says what each action actually is.
risk:
  unclassified: deny         # an action the profile does not classify never runs
  writeHandling: confirm     # a write needs a person unless the capability is approved
  sensitiveHandling: allow_redacted

budgets:
  maxStepsPerRun: 40
  maxModelCallsPerRun: 40
  maxRunDurationMs: 300000

data:
  neverPersist: [password, token, ssn, cardNumber, cvv, pin, apiKey]
  # flags is an explicit field. An inline (?i) is PCRE syntax and JavaScript throws
  # when it constructs the expression, so it appears nowhere in this file.
  redactPatterns:
    - { name: ssn, pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b", flags: "g" }
    - { name: cardNumber, pattern: "\\b(?:\\d[ -]*?){13,19}\\b", flags: "g", validator: luhn }
    - { name: email, pattern: "\\b[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}\\b", flags: "gi" }
    - { name: phone, pattern: "\\b(?:\\+?1[ .-]?)?\\(?\\d{3}\\)?[ .-]?\\d{3}[ .-]?\\d{4}\\b", flags: "g" }
    - { name: accountNumber, pattern: "\\b\\d{9,17}\\b", flags: "g", contextual: true }
```

Path matching is glob over the canonicalised path with the query string stripped. Denied wins over allowed. Origin matching is exact scheme, host, and port, with no wildcard hosts, because a wildcard host allowlist in a multitenant system is not an allowlist.

`/__control__/**` is denied. The target app mounts its own fault injection there, and an agent that can arm the faults it is being tested against is not being tested. It is a small thing that proves the allowlist constrains something real.

There is no rate limit on actions against the target app. The budgets bound a run's length, not its speed. That is a cut, named in `PROGRESS.md`.

## 3. Risk classification

Two independent properties, declared per step and cross checked against the app profile route and method table, plus a sensitivity flag from the same profile. This is ADR 0014.

| Property | Question it answers | Decided by | Governs |
| --- | --- | --- | --- |
| `effect` | Does this change the institution system of record | Profile route table | Whether a person confirms |
| `idempotent` | Is repeating this free | Profile route table | Whether a failed attempt is retried |
| `sensitive` | Does this touch regulated data | Profile field sensitivity map | Redaction and screenshot masking |

| Case | Discovery | Replay, draft | Replay, approved |
| --- | --- | --- | --- |
| read | allow | allow | allow |
| read, sensitive | allow, redaction enforced | allow | allow |
| write | confirm | confirm | allow, if the capability declares `allowUnattendedReplay` |

The policy engine reads the effect a capability declares for its own steps, and the network guard enforces it against the profile, per ADR 0014 as amended. While a step runs, a request the profile does not list is refused, and a request the profile calls a write is refused under a step declared as a read. A capability whose declared effect contradicts the profile therefore fails as `PolicyDenied` before the write lands.

The first version of this section had one enum and classified any POST as irreversible. The member search on the target app is a POST. That made the primary read capability require human confirmation on every discovery and every draft replay, and it made the transient retry case unreachable, because the schema forbids retrying an irreversible step. A search is a read that is not idempotent. One enum could not say that, and the regex over button names that sat beside it was the same defect in a different place.

### Why confirm rather than block

Blocking writes outright would make the system useless. "Open a new sub account and reach the confirmation screen" is one of the brief's own example goals, and it is a write by definition. A system that can only read is not an integration layer, it is a scraper.

Blocking is also weaker than it looks. It pushes the work back to a human who then does the whole task manually, with no audit trail and no capability produced. Confirm keeps the human in the decision seat for the one action that matters while the automation does the other steps.

The escalation is where the confirmation happens, which means the person confirming sees the live screen, the step intent, and the full context. Approving a change to a member's account from a screenshot and a sentence is a meaningfully better control than approving it from a log line.

### Why approved capabilities can run unattended

Once a capability has been reviewed by a human who understood exactly what it does, confirming every replay of the same reviewed flow is theatre. It trains operators to click approve without reading, which is worse than no control. The gate moves to review time, where attention actually exists. `lifecycle.status` must be `approved` and `policy.allowUnattendedReplay` must be true, and both changes are visible in git history.

## 4. Redaction

Redaction happens at the sink, never at the call site. Every write path funnels through a `Redactor`.

```ts
interface Redactor {
  text(s: string, ctx: RedactionContext): string;
  object(value: unknown, ctx: RedactionContext): unknown;   // sinks serialise the result, so no type is claimed
}
```

Sinks that must use it, with no exceptions. The structured logger. The artifact writer. The evidence writer. The screenshot writer. The model prompt builder. The operator API responses.

The operator API is the one that is easy to forget. An intervention payload carries a screenshot and an accessibility snapshot of a member's account, and it is sent to a browser over HTTP. It gets redacted like everything else.

A result exists in two projections and the difference is explicit. The **caller projection** carries real output values, because an agent that asked for a balance and received `[redacted]` has been handed a system that does not work. The replay CLI returns it to the process that invoked it and to nothing else. The **persisted projection** is redacted, and it is what reaches logs, evidence and the trace.

### Three redaction mechanisms

1. **Provenance based.** Any value that came from an input declared `pii` or `secret` is tracked by reference. It is never written as a literal anywhere. In artifacts it is always `{{inputs.x}}`. This is exact rather than heuristic, and it is the primary mechanism.
2. **Pattern based.** The regex set in the allowlist, applied to all free text before it is written. Card numbers are Luhn validated to cut false positives. This is the safety net for data we did not put there ourselves, such as an account number rendered on a page.
3. **Region masking.** Elements the app profile marks sensitive have their bounding box painted over by Playwright's own screenshot mask option, so an unmasked buffer never exists in the process rather than merely never being written. The profile is what makes this work for a member name. No pattern finds a name, so a mechanism that relied only on regexes would have left one visible in every committed screenshot while the document claimed otherwise.

### Sensitivity propagation

An output extracted from an element populated by a `secret` input inherits `secret`. A `money` value read from a member account is `pii`. Propagation is a pure function and unit tested, because getting it wrong silently is the failure mode that matters.

### What the model sees

The observation sent to the model is redacted before the prompt is built. The model sees `[redacted:pii]` in place of a member's name or balance. It does not need real PII to decide which button to click, and sending regulated financial data to a third party inference API when the task does not require it is not defensible.

The one exception is values the model must type, which are supplied as template references such as `{{inputs.memberId}}` rather than literals. The model asks to fill a field with a named input. The executor resolves it. The model never sees the value. The goal it is given is templated the same way.

## 5. What the guardrails do not cover

For `REPORT.md`. Stating the limits is part of the deliverable.

* **Prompt injection from page content.** A malicious page could contain text instructing the model to navigate elsewhere. The allowlist contains the blast radius, since it cannot leave permitted origins or perform denied actions, but it could still be steered into a permitted but wrong action. Real mitigations are structural output constraints, treating page text as data rather than instruction in the prompt, and an anomaly check on the action sequence. We implement the first two and note the third.
* **Semantic correctness.** Policy can tell that a click targets a submit button. It cannot tell that the submit is for the wrong member. Checkpoints and typed outputs are the mitigation, and they are partial.
* **Regex redaction is imperfect.** It will miss unusual account formats and occasionally over redact. Provenance based redaction is the strong mechanism and pattern matching is the net, not the floor.
* **The operator is trusted.** Their actions during a control window are recorded but not authorized action by action. There is one real control. A `context.route` handler refuses any request to an origin or path outside the allowlist, which applies to the human window exactly as it applies to automation, and it is also what keeps either of them out of `/__control__`. Semantic constraint on what an operator does inside a permitted origin is not built.
* **No egress control.** A compromised dependency could exfiltrate. Out of scope, worth naming.
* **No rate limit.** A model in a loop is bounded in steps and duration but not in speed. Against a fragile legacy system that matters, and the next thing to build here is a throttle through the injected clock.
* **Screenshot masking depends on correct element detection.** A sensitive value rendered inside a canvas or an image will not be masked. The mitigation is not persisting screenshots at all on steps marked `sensitive` unless evidence capture is explicitly enabled.

## 6. Tests that must exist

Listed here because safety properties are exactly the ones that rot silently.

* `authorize` denies every origin not in the allowlist, table driven.
* `authorize` denies every action kind not in the allowed set.
* Denied paths beat allowed paths on overlap.
* An unknown action kind yields `deny`, proving the default branch.
* A `write` action yields `confirm` during discovery and during a draft replay, and `allow` only when the capability is approved and declares `allowUnattendedReplay`.
* A request the profile does not classify is refused while a step runs, proving the fail closed default.
* An approval grant is accepted exactly once and refused on a second presentation.
* A secret input value never appears in the serialised artifact, asserted by scanning the JSON for the literal.
* A secret input value never appears in any log line produced during a run, asserted by capturing the log sink.
* Screenshot masking covers the declared regions, asserted on pixel samples.
* The model prompt contains no unredacted PII, asserted against a fixture observation.
* `src/discovery` and `src/replay` do not import the unguarded driver, asserted over the import graph.
* Budgets terminate a run that exceeds max steps or max duration.
* A request to an origin or path outside the allowlist is refused at the network layer, including while a human holds control.
* The evidence scanner fails on a planted canary and passes on the committed tree.
