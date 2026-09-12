# Safety and policy guardrails

This is regulated financial data operated by a non deterministic model. The guardrail model has to assume the model will occasionally try to do something wrong, and make that structurally impossible rather than merely discouraged.

## 1. The single choke point

Every action that reaches a surface passes through one function.

```ts
PolicyEngine.authorize(action: ProposedAction, ctx: PolicyContext): AuthorizationDecision
```

The agent loop does not hold a `SurfaceDriver`. It holds a `GuardedSurface` that wraps the driver and calls `authorize` before delegating. The unguarded driver is not exported from its module. This means bypassing policy requires editing the wiring, not forgetting a call, and a code reviewer looking for policy bypasses has one place to look.

A unit test asserts that `src/discovery` and `src/replay` do not import the raw driver module. Enforcing an architectural rule with a test is cheaper than enforcing it with a convention.

Decisions are three valued, never boolean.

```ts
type AuthorizationDecision =
  | { verdict: 'allow' }
  | { verdict: 'deny'; rule: string; reason: string }
  | { verdict: 'confirm'; rule: string; reason: string; risk: RiskLevel };
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
      - "/**/delete"
      - "/**/wire/**"

actions:
  allowed: [navigate, click, fill, select, press, hover, scroll, waitFor, extract, assert, dismiss]
  denied: [upload, download, execScript, newTab, clipboardRead]

risk:
  irreversible:
    matchers:
      - { kind: roleName, role: button, namePattern: "(?i)(submit|confirm|transfer|wire|delete|close account|approve)" }
      - { kind: httpMethod, methods: [POST, PUT, DELETE, PATCH] }
    handling: confirm
  sensitive:
    matchers:
      - { kind: roleName, role: textbox, namePattern: "(?i)(ssn|social|tax id|pin|password|card number)" }
    handling: allow_redacted
  default: safe

budgets:
  maxStepsPerRun: 40
  maxModelCallsPerRun: 40
  maxRunDurationMs: 300000
  maxActionsPerMinute: 60

data:
  neverPersist: [password, token, ssn, cardNumber, cvv, pin, apiKey]
  redactPatterns:
    - { name: ssn, pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b" }
    - { name: cardNumber, pattern: "\\b(?:\\d[ -]*?){13,19}\\b", validator: luhn }
    - { name: email, pattern: "\\b[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}\\b" }
    - { name: phone, pattern: "\\b\\+?1?[ .-]?\\(?\\d{3}\\)?[ .-]?\\d{3}[ .-]?\\d{4}\\b" }
    - { name: accountNumber, pattern: "\\b\\d{9,17}\\b", contextual: true }
```

Path matching is glob over the canonicalised path with the query string stripped. Denied wins over allowed. Origin matching is exact scheme, host, and port, with no wildcard hosts, because a wildcard host allowlist in a multitenant system is not an allowlist.

`maxActionsPerMinute` is a rate limit, not a budget. It exists because the brief tells us to respect rate limits on target systems, and because a model in a loop can otherwise hammer a legacy app that was never built for it.

## 3. Risk classification

Three levels, classified from the action kind plus the target's accessibility metadata plus the HTTP method the action is expected to trigger.

| Level | Definition | Discovery | Replay, draft | Replay, approved |
| --- | --- | --- | --- | --- |
| `safe` | Read only or trivially reversible. Navigate, click a link, fill a field, extract | allow | allow | allow |
| `sensitive` | Touches regulated data. Filling an SSN field, reading a full account number | allow, with redaction enforced | allow | allow |
| `irreversible` | Changes state in the institution's system of record. Submits, transfers, account creation | confirm | confirm | allow, if the capability declares `allowUnattendedReplay` |

### Why confirm rather than block

Blocking irreversible actions outright would make the system useless. "Open a new sub account and reach the confirmation screen" is one of the brief's own example goals, and it is irreversible by definition. A system that can only read is not an integration layer, it is a scraper.

Blocking is also weaker than it looks. It pushes the work back to a human who then does the whole task manually, with no audit trail and no capability produced. Confirm keeps the human in the decision seat for the one action that matters while the automation does the other thirty steps.

The escalation is where the confirmation happens, which means the person confirming sees the live screen, the step intent, and the full context. Approving a change to a member's account from a screenshot and a sentence is a meaningfully better control than approving it from a log line.

### Why approved capabilities can run unattended

Once a capability has been reviewed by a human who understood exactly what it does, confirming every replay of the same reviewed flow is theatre. It trains operators to click approve without reading, which is worse than no control. The gate moves to review time, where attention actually exists. `lifecycle.status` must be `approved` and `policy.allowUnattendedReplay` must be true, and both changes are visible in git history.

## 4. Redaction

Redaction happens at the sink, never at the call site. Every write path funnels through a `Redactor`.

```ts
interface Redactor {
  text(s: string, ctx: RedactionContext): string;
  object<T>(o: T, ctx: RedactionContext): T;
  screenshot(buf: Buffer, masks: Box[]): Promise<Buffer>;
}
```

Sinks that must use it, with no exceptions. The structured logger. The artifact writer. The evidence writer. The screenshot writer. The model prompt builder. The operator API responses. The catalog API responses.

That last one is easy to forget. An intervention payload carries a screenshot and an accessibility snapshot of a member's account, and it is being sent to a browser over HTTP. It gets redacted like everything else.

### Three redaction mechanisms

1. **Provenance based.** Any value that came from an input declared `pii` or `secret` is tracked by reference. It is never written as a literal anywhere. In artifacts it is always `{{inputs.x}}`. This is exact rather than heuristic, and it is the primary mechanism.
2. **Pattern based.** The regex set in the allowlist, applied to all free text before it is written. Card numbers are Luhn validated to cut false positives. This is the safety net for data we did not put there ourselves, such as an account number rendered on a page.
3. **Region masking.** Elements whose accessibility name or nearby label matches a sensitive pattern have their bounding box painted over before the screenshot bytes are written. The unmasked buffer is never persisted and never leaves the process.

### Sensitivity propagation

An output extracted from an element populated by a `secret` input inherits `secret`. A `money` value read from a member account is `pii`. Propagation is computed in `core/redaction/propagate.ts` as a pure function and unit tested, because getting it wrong silently is the failure mode that matters.

### What the model sees

The observation sent to the model is redacted before the prompt is built. The model sees `[redacted:pii]` in place of a member's name or balance. It does not need real PII to decide which button to click, and sending regulated financial data to a third party inference API when the task does not require it is not defensible.

The one exception is values the model must type, which are supplied as template references such as `{{inputs.memberId}}` rather than literals. The model asks to fill a field with a named input. The executor resolves it. The model never sees the value.

## 5. What the guardrails do not cover

For `REPORT.md`. Stating the limits is part of the deliverable.

* **Prompt injection from page content.** A malicious page could contain text instructing the model to navigate elsewhere. The allowlist contains the blast radius, since it cannot leave permitted origins or perform denied actions, but it could still be steered into a permitted but wrong action. Real mitigations are structural output constraints, treating page text as data rather than instruction in the prompt, and an anomaly check on the action sequence. We implement the first two and note the third.
* **Semantic correctness.** Policy can tell that a click targets a submit button. It cannot tell that the submit is for the wrong member. Checkpoints and typed outputs are the mitigation, and they are partial.
* **Regex redaction is imperfect.** It will miss unusual account formats and occasionally over redact. Provenance based redaction is the strong mechanism and pattern matching is the net, not the floor.
* **The operator is trusted.** Their actions during a control window are recorded but not constrained by the allowlist. Prevention here needs input level policy enforcement on the CDP forwarding path, which is designed but not built.
* **No egress control.** A compromised dependency could exfiltrate. Out of scope, worth naming.
* **Screenshot masking depends on correct element detection.** A sensitive value rendered inside a canvas or an image will not be masked. The mitigation is not persisting screenshots at all on steps marked `sensitive` unless evidence capture is explicitly enabled.

## 6. Tests that must exist

Listed here because safety properties are exactly the ones that rot silently.

* `authorize` denies every origin not in the allowlist, table driven.
* `authorize` denies every action kind not in the allowed set.
* Denied paths beat allowed paths on overlap.
* An unknown action kind yields `deny`, proving the default branch.
* Irreversible matchers yield `confirm` during discovery, and `allow` only when status is approved and the flag is set.
* A secret input value never appears in the serialised artifact, asserted by scanning the JSON for the literal.
* A secret input value never appears in any log line produced during a run, asserted by capturing the log sink.
* Screenshot masking covers the declared boxes, asserted on pixel samples.
* The model prompt contains no unredacted PII, asserted against a fixture observation.
* `src/discovery` and `src/replay` do not import the unguarded driver, asserted over the import graph.
* Budgets terminate a run that exceeds max steps, max duration, or the rate limit.
