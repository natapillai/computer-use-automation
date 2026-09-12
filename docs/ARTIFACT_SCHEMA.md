# Capability artifact schema

The brief calls this a focal point of the evaluation. Treat this document as the specification and `src/core/capability/schema.ts` as its executable form. Zod is the source of truth, TypeScript types are inferred from it, and the JSON Schema published to the catalog is generated from it. One definition, three consumers.

## 1. Design principles

1. **It is a capability contract, not a macro recording.** An AI agent must be able to read it and know what it needs, what it returns, and what can go wrong, without reading the steps. That means typed inputs, typed outputs, and declared business outcomes are first class, not metadata.
2. **It is reviewable by a human.** Every step carries an `intent` in plain language and every locator carries a `describedAs`. A compliance reviewer at a bank must be able to read this and understand what the automation does to a member account.
3. **It is decoupled from the transcript.** No model messages, no reasoning traces, no token counts. Provenance points at the discovery run by ID, it does not embed it.
4. **It cannot carry sensitive data.** Values are templates or literals, and the generalizer refuses to emit a literal that came from a sensitive input or that trips the redactor. Schema validation enforces this, so an unsafe artifact cannot be written.
5. **It versions two things independently.** `schemaVersion` is the shape of this file. `version` is the capability itself. A replay engine checks the former for compatibility and the latter for which behaviour it is invoking.
6. **Structure is shared, specifics are overridable.** Cross tenant reuse depends on a tenant being able to override a locator without forking the flow.

## 2. Top level shape

```ts
const Capability = z.object({
  schemaVersion: z.literal('1.0.0'),

  id: z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/),  // 'member.readSavingsBalance'
  version: z.string().regex(SEMVER),
  name: z.string().min(1),
  description: z.string().min(1),        // agent facing, this is what a tool description becomes

  app: AppBinding,
  surface: SurfaceRequirement,

  inputs: z.array(ParamSpec),
  outputs: z.array(OutputSpec),
  outcomes: z.array(BusinessOutcomeSpec),

  steps: z.array(Step).min(1),
  successCondition: Checkpoint,

  policy: CapabilityPolicy,
  provenance: Provenance,
  lifecycle: Lifecycle,
});
```

## 3. Field by field, with the reasoning

### `app` and `surface`

```ts
const AppBinding = z.object({
  appId: z.string(),             // 'meridian-core'
  vendor: z.string(),            // 'meridian'
  productVersion: z.string().optional(),
  variant: z.string().default('base'),   // 'base' | 'vendorX-v9' | 'tenant-acme'
  baseUrl: z.string().optional(),        // supplied by the tenant binding, not baked in
  entryPath: z.string(),                 // '/servicing/search', canonicalised
});

const SurfaceRequirement = z.object({
  kind: z.enum(['web', 'legacy-web', 'desktop']),
  minDriverVersion: z.string(),
  capabilitiesRequired: z.array(z.enum(['frames', 'dialogs', 'fileUpload', 'clipboard'])),
});
```

`baseUrl` is optional and normally absent. A capability recorded against one institution's host must not carry that host. The tenant binding supplies it at invocation. This is the difference between an artifact that generalises and one that has a customer's hostname baked into it.

`surface.kind` and `capabilitiesRequired` let the executor refuse to run a capability on a driver that cannot satisfy it, rather than failing in a confusing way at step nine.

### `inputs`

```ts
const ParamSpec = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'enum']),
  enumValues: z.array(z.string()).optional(),
  required: z.boolean(),
  description: z.string(),
  example: z.string().optional(),        // redacted, synthetic, never from the real run
  sensitivity: z.enum(['public', 'internal', 'pii', 'secret']),
  constraints: z.object({
    pattern: z.string().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }).optional(),
});
```

`sensitivity` is the mechanism that drives redaction, not a label. A value typed into a field bound to a `pii` or `secret` input is never written to a log, never written to the artifact, and the region of any screenshot containing it is masked before the screenshot is persisted. Sensitivity propagates, so an output extracted from a field fed by a `secret` input inherits the higher classification.

`constraints` are validated before the browser opens. Rejecting a malformed member ID in ten milliseconds is better than discovering it after six page loads, and it keeps garbage input out of the target system.

### `outputs`

```ts
const OutputSpec = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'money', 'object', 'array']),
  description: z.string(),
  sensitivity: z.enum(['public', 'internal', 'pii', 'secret']),
  required: z.boolean(),
  source: z.object({
    stepId: z.string(),
    target: LocatorBundle,
    attribute: z.enum(['text', 'value', 'ariaValue', 'href', 'checked']).default('text'),
    parse: ParseRule.optional(),         // { kind: 'money', currency: 'USD' } etc
  }),
});
```

Outputs are declared with their own locator bundle rather than being scraped ad hoc, because reading a balance is exactly as failure prone as clicking a button and deserves the same treatment. A required output that cannot be resolved is a hard failure, not a silent `undefined`. That distinction matters when the caller is an AI agent about to tell a member their balance.

`money` is its own type. A balance is not a float and it is not a display string. It carries an amount, a currency, and the raw text it was parsed from, so a downstream mismatch is debuggable.

### `outcomes`

This is the field most submissions will not have, and it is the one the brief singles out in the glossary.

```ts
const BusinessOutcomeSpec = z.object({
  code: z.string(),                  // 'MEMBER_NOT_FOUND'
  description: z.string(),
  terminal: z.boolean(),             // does the flow stop here
  detect: ConditionMatcher,          // how replay recognises it
  data: z.array(OutputSpec).optional(),  // structured detail, eg the validation message
});
```

A declared outcome is a supported answer from the capability, not an error. `MEMBER_NOT_FOUND`, `ACCOUNT_FROZEN`, `INSUFFICIENT_PERMISSIONS`, `DUPLICATE_SUBACCOUNT`. The calling agent branches on `outcome.code`. Anything the system encounters that is not a declared outcome and not a recoverable condition is a failure by definition, which keeps the taxonomy closed and forces new real world conditions to be added deliberately rather than swallowed.

### `steps`

```ts
const Step = z.object({
  id: z.string(),                    // stable, referenced by overlays and outputs
  index: z.number().int(),
  intent: z.string(),                // 'Submit the member search form'

  action: Action,                    // discriminated union on `kind`
  target: LocatorBundle.optional(),  // absent for navigate, waitFor, assert
  value: TemplateExpr.optional(),    // '{{inputs.memberId}}' or a literal

  precondition: Checkpoint.optional(),
  postcondition: Checkpoint.optional(),

  risk: z.enum(['safe', 'sensitive', 'irreversible']),
  retry: RetryPolicy,
  timeoutMs: z.number().int().default(15000),

  onCondition: z.array(ConditionRule).default([]),  // recoveries and outcome detection
  optional: z.boolean().default(false),             // eg an interstitial that may not appear

  surfaceFingerprint: z.string().optional(),        // drift signal, hash of AX skeleton
  provenance: z.enum(['model', 'human', 'manual']).default('model'),
});
```

`id` being stable and separate from `index` is what makes overlays and reordering safe. An overlay says "for this tenant, step `searchSubmit` uses this locator", and it survives a step being inserted before it.

`provenance` at the step level records that a human performed this step during an escalation. Those steps land as proposals on a draft revision and require approval before they replay unattended. A step nobody reviewed should not run against a member account at three in the morning.

`optional` handles the interstitial that appears for some tenants and not others. It is the smallest possible answer to a very common real cause of cross tenant breakage.

### `successCondition` and `Checkpoint`

```ts
const Checkpoint = z.object({
  description: z.string(),
  assertions: z.array(Assertion).min(1),
  mode: z.enum(['all', 'any']).default('all'),
  timeoutMs: z.number().int().default(10000),
});

type Assertion =
  | { kind: 'elementPresent'; target: LocatorBundle }
  | { kind: 'elementAbsent'; target: LocatorBundle }
  | { kind: 'textMatches'; target: LocatorBundle; pattern: string }
  | { kind: 'urlMatches'; pattern: string }
  | { kind: 'outputResolvable'; outputName: string };
```

`urlMatches` alone is never sufficient and the schema does not enforce that, but the generalizer will not emit a checkpoint containing only a URL assertion. In a frameset app the URL frequently does not change at all when the state does.

### `policy`

```ts
const CapabilityPolicy = z.object({
  maxRisk: z.enum(['safe', 'sensitive', 'irreversible']),
  requiresApproval: z.boolean(),
  allowUnattendedReplay: z.boolean(),
  allowAssistedRecovery: z.boolean().default(false),
  allowedOrigins: z.array(z.string()),
  maxStepDurationMs: z.number().int(),
  maxTotalDurationMs: z.number().int(),
});
```

The capability declares its own ceiling and the global allowlist declares the system ceiling. The effective policy is the intersection, so a capability can be more restrictive than the system but never less. That is the only safe direction for this to compose.

### `provenance`

```ts
const Provenance = z.object({
  recordedAt: z.string().datetime(),
  discoveryRunId: z.string(),        // pointer into evidence/, not the transcript itself
  model: z.string(),
  promptVersion: z.string(),
  recorderVersion: z.string(),
  generalizerVersion: z.string(),
  redactionApplied: z.literal(true), // schema level assertion, cannot be written otherwise
  derivedFrom: z.object({ id: z.string(), version: z.string() }).optional(),
});
```

`redactionApplied` as a literal `true` means an artifact that skipped redaction cannot be serialised through the schema. Encoding the safety property in the type is stronger than remembering to call a function.

`promptVersion` and `generalizerVersion` exist because when an artifact turns out to be badly recorded, the first question is which version of our own pipeline produced it.

### `lifecycle`

```ts
const Lifecycle = z.object({
  status: z.enum(['draft', 'approved', 'deprecated']),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  stability: z.object({
    replays: z.number().int(),
    successes: z.number().int(),
    lastSuccessAt: z.string().datetime().optional(),
    lastDriftAt: z.string().datetime().optional(),
    consecutiveFailures: z.number().int(),
  }),
  supersededBy: z.string().optional(),
});
```

A freshly discovered artifact is `draft`. Unattended replay requires `approved`. This is a three line gate in the executor and it is the difference between a demo and something you would let near a core banking system.

## 4. Templating

`TemplateExpr` is a string with `{{...}}` references. Scope is restricted to `inputs.*`, `outputs.*` for values already extracted earlier in the flow, and `env.*` for a small explicit allowlist of non secret runtime values. There is no expression language, no arithmetic, no function calls. Resolution is a pure function, exhaustively unit tested, and an unresolved reference is a hard failure before any action is taken.

The restriction is deliberate. The moment templates become Turing complete the artifact stops being reviewable, and reviewability is a requirement.

## 5. Storage and versioning

```
capabilities/<id>/base@<version>.json
capabilities/<id>/variants/<variant>@<version>.json
capabilities/<id>/index.json
```

JSON, pretty printed, stable key order, committed to git. Git gives us history, diffs, and review on a file a compliance team could actually read in a pull request. A database buys nothing at this scale and costs reviewability.

Version bumping rules, enforced by a unit test over a fixture pair.

* **Patch.** A locator bundle gains a strategy, a timeout changes, a description improves.
* **Minor.** A step is added or an optional input or a new declared outcome appears. Existing callers keep working.
* **Major.** Inputs, outputs, or the success condition change shape. Existing callers break.

Replay checks `schemaVersion` for engine compatibility and refuses to run an artifact from a future schema. Callers pin `id@major` and get patches for free.

## 6. Worked example

`capabilities/member.readSavingsBalance/base@1.0.0.json`, abbreviated.

```json
{
  "schemaVersion": "1.0.0",
  "id": "member.readSavingsBalance",
  "version": "1.0.0",
  "name": "Read member savings balance",
  "description": "Looks up a member by ID and returns the current balance of their primary savings account.",
  "app": { "appId": "meridian-core", "vendor": "meridian", "variant": "base", "entryPath": "/servicing/search" },
  "surface": { "kind": "legacy-web", "minDriverVersion": "1.0.0", "capabilitiesRequired": ["frames"] },
  "inputs": [
    { "name": "memberId", "type": "string", "required": true, "sensitivity": "pii",
      "description": "Institution member number", "constraints": { "pattern": "^[0-9]{5,10}$" } }
  ],
  "outputs": [
    { "name": "savingsBalance", "type": "money", "required": true, "sensitivity": "pii",
      "description": "Current balance of the primary savings account",
      "source": { "stepId": "readBalanceCell", "target": { "...": "locator bundle" },
                  "attribute": "text", "parse": { "kind": "money", "currency": "USD" } } }
  ],
  "outcomes": [
    { "code": "MEMBER_NOT_FOUND", "terminal": true,
      "description": "No member exists with the supplied ID.",
      "detect": { "kind": "textMatches", "target": { "...": "results banner" }, "pattern": "No records found" } },
    { "code": "ACCOUNT_RESTRICTED", "terminal": true,
      "description": "The member exists but the operator lacks permission to view balances.",
      "detect": { "kind": "textMatches", "target": { "...": "error region" }, "pattern": "not authorized" } }
  ],
  "steps": [
    { "id": "openSearch", "index": 0, "intent": "Open the member search screen",
      "action": { "kind": "navigate", "path": "/servicing/search" },
      "risk": "safe", "retry": { "attempts": 2, "backoffMs": 500 }, "timeoutMs": 15000,
      "postcondition": { "description": "Search form is present",
        "assertions": [{ "kind": "elementPresent", "target": { "...": "member id field" } }] } },
    { "id": "fillMemberId", "index": 1, "intent": "Enter the member ID",
      "action": { "kind": "fill" }, "value": "{{inputs.memberId}}",
      "target": { "framePath": ["content"], "matchPolicy": "unique", "describedAs": "Member ID input",
        "strategies": [
          { "kind": "role-name", "role": "textbox", "name": "Member ID", "exact": true, "confidence": 0.95 },
          { "kind": "anchor-relative", "anchor": { "kind": "text", "text": "Member ID", "exact": true, "confidence": 0.8 },
            "relation": "sameRowInput", "confidence": 0.75 },
          { "kind": "structural", "path": "form#srch >> tr:nth-child(2) >> input", "confidence": 0.4 }
        ] },
      "risk": "safe", "retry": { "attempts": 2, "backoffMs": 250 }, "timeoutMs": 10000 }
  ],
  "successCondition": {
    "description": "Member detail screen shows a savings balance",
    "assertions": [
      { "kind": "elementPresent", "target": { "...": "balance cell" } },
      { "kind": "outputResolvable", "outputName": "savingsBalance" }
    ]
  },
  "policy": { "maxRisk": "safe", "requiresApproval": true, "allowUnattendedReplay": false,
              "allowedOrigins": ["http://localhost:4010"], "maxStepDurationMs": 20000, "maxTotalDurationMs": 120000 },
  "provenance": { "recordedAt": "2026-09-11T00:00:00Z", "discoveryRunId": "run_01J...",
                  "model": "claude-sonnet-4-6", "promptVersion": "1.0.0",
                  "recorderVersion": "1.0.0", "generalizerVersion": "1.0.0", "redactionApplied": true },
  "lifecycle": { "status": "draft", "stability": { "replays": 0, "successes": 0, "consecutiveFailures": 0 } }
}
```

## 7. What the schema deliberately does not have

* **Conditional branching and loops.** A capability is one flow with declared outcomes. Branching belongs to the calling agent, which composes capabilities. Putting control flow in the artifact turns it into a programming language and destroys reviewability.
* **Embedded credentials or a login flow.** Authentication is a session concern handled by the `SessionBroker` before replay starts.
* **The model transcript.** It lives in evidence, referenced by `discoveryRunId`.
* **Timing data from the recording.** Record time durations are a property of that machine on that day. Waits are conditions, never replayed durations.
