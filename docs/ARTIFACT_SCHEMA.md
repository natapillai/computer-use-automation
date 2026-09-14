# Capability artifact schema

The brief calls this a focal point of the evaluation. Treat this document as the specification and `src/core/capability/schema.ts` as its executable form. Zod is the source of truth, TypeScript types are inferred from it, and the JSON Schema a calling agent reads is generated from it at S7-T02. One definition, three consumers.

## 1. Design principles

1. **It is a capability contract, not a macro recording.** An AI agent must be able to read it and know what it needs, what it returns, and what can go wrong, without reading the steps. That means typed inputs, typed outputs, and declared business outcomes are first class, not metadata.
2. **It is reviewable by a human.** Every step carries an `intent` in plain language and every locator carries a `describedAs`. A compliance reviewer at a bank must be able to read this and understand what the automation does to a member account.
3. **It is decoupled from the transcript.** No model messages, no reasoning traces, no token counts. Provenance points at the discovery run by ID, it does not embed it.
4. **It cannot carry sensitive data.** Values are templates or literals, and the generalizer refuses to emit a literal that came from a sensitive input or that trips the redactor. Locator text and navigate paths are templated too, because a derived strategy that matches a search result row, or a recorded path to a member's detail page, would otherwise commit a member ID. The enforcement is the writer, which scans for declared input values and redactor matches and refuses to serialise on a hit. A schema cannot know where a literal came from, and `redactionApplied` is a marker that the writer ran, not proof that it worked.
5. **It versions two things independently.** `schemaVersion` is the shape of this file. `version` is the capability itself. A replay engine checks the former for compatibility and the latter for which behaviour it is invoking.
6. **Its structure could be shared across tenants.** Cross tenant reuse depends on a tenant being able to override a locator without forking the flow. The overlay design in section 5 does that. It is specified and not built.

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
  entryPath: z.string(),         // '/servicing', the frameset shell
});

const SurfaceRequirement = z.object({
  kind: z.enum(['web', 'legacy-web', 'desktop']),
  minDriverVersion: z.string(),
  capabilitiesRequired: z.array(z.enum(['frames', 'dialogs', 'fileUpload', 'clipboard'])),
});
```

The artifact carries no base URL. A capability recorded against one institution's host must not carry that host, so the application URL comes from environment config at invocation. In a multitenant deployment that config is where a per tenant binding would plug in. This is the difference between an artifact that generalises and one that has a customer's hostname baked into it.

`surface.kind` and `capabilitiesRequired` let the executor refuse to run a capability on a driver that cannot satisfy it, rather than failing in a confusing way at step nine.

### `inputs`

```ts
const ParamSpec = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'enum']),
  enumValues: z.array(z.string()).optional(),
  required: z.boolean(),
  description: z.string(),
  example: z.string().optional(),        // synthetic, never from the real run
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

`sensitivity` is the mechanism that drives redaction, not a label. Field level sensitivity also comes from the app profile, which is how a member name gets masked. No regex finds a name, and pattern redaction alone would have left one in every screenshot and every prompt. A value typed into a field bound to a `pii` or `secret` input is never written to a log, never written to the artifact, and the region of any screenshot containing it is masked before the screenshot is persisted. Sensitivity propagates, so an output extracted from a field fed by a `secret` input inherits the higher classification.

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

Outputs are declared with their own locator bundle rather than being scraped ad hoc, because reading a balance is exactly as failure prone as clicking a button and deserves the same treatment. There is no `extract` step kind in an artifact. An output resolves after the step named in `source.stepId` completes, through the same resolution policy as any action target. Carrying the locator in two places, once on an extract step and once on the output, would let them disagree. A required output that cannot be resolved is a hard failure, not a silent `undefined`. That distinction matters when the caller is an AI agent about to tell a member their balance.

`money` is its own type. A balance is not a float and it is not a display string. It carries an amount in minor units, a currency, and the raw text it was parsed from, so a downstream mismatch is debuggable. That raw text is `pii`, so it is present in the value returned to the caller and redacted in every persisted projection.

### `outcomes`

This is the field most submissions will not have, and it is the one the brief singles out in the glossary.

```ts
const BusinessOutcomeSpec = z.object({
  code: z.string(),                  // 'MEMBER_NOT_FOUND'
  description: z.string(),
  terminal: z.boolean(),             // does the flow stop here
  detect: ConditionMatcher,          // how replay recognises it, derived from a real element
  data: z.array(OutputSpec).optional(),  // structured detail, eg the validation message
  provenance: z.enum(['model', 'manual']).default('manual'),
});
```

A declared outcome is a supported answer from the capability, not an error. Outcomes reach the artifact through the negative probe review in ADR 0018, not by hand and not by inference. A single happy path discovery run never sees the not found banner, so without that review step a discovered artifact would declare nothing and its first unhappy replay would report a failure. `MEMBER_NOT_FOUND`, `ACCOUNT_RESTRICTED`, `SUBACCOUNT_VALIDATION`. The calling agent branches on `outcome.code`. Anything the system encounters that is not a declared outcome and not a recoverable condition is a failure by definition, which keeps the taxonomy closed and forces new real world conditions to be added deliberately rather than swallowed.

### `steps`

```ts
const Step = z.object({
  id: z.string(),                    // stable, referenced by outputs
  index: z.number().int(),
  intent: z.string(),                // 'Submit the member search form'

  action: Action,                    // discriminated union on `kind`
  target: LocatorBundle.optional(),  // absent for navigate
  value: TemplateExpr.optional(),    // '{{inputs.memberId}}' or a literal

  precondition: Checkpoint.optional(),
  postcondition: Checkpoint,              // required on every acting step

  effect: z.enum(['read', 'write']),      // drives confirmation
  idempotent: z.boolean(),                // drives retry
  sensitive: z.boolean().default(false),  // touches regulated data, drives redaction
  retry: RetryPolicy,
  timeoutMs: z.number().int().default(15000),

  onCondition: z.array(ConditionRule).default([]),  // step level detectors
  provenance: z.enum(['model', 'manual']).default('model'),
});
```

A `navigate` action carries a `path`, which is a `TemplateExpr`, and a `framePath`. Navigating the top level document to a content frame URL would destroy a frameset, so the frame is always explicit.

`effect` and `idempotent` are two properties and not one enum, which is ADR 0014. `effect` decides whether a person confirms. `idempotent` decides whether a failed attempt can be retried. The search on the target app is a POST, so it is not idempotent, and it is also a read that nobody should have to approve. A single risk enum could not say both of those things at once, and the version that tried classified the primary read capability as irreversible. Both values are declared per step and cross checked against the app profile route table at replay.

`id` is stable and separate from `index`. Outputs reference a step by id, and the overlay design keys its overrides by id, which survives a step being inserted before it.

`provenance` records whether a step came from the model's run or was added by a person at review. Human actions during an escalation are recorded in evidence and never become steps, see `docs/ESCALATION.md` section 6.

### `successCondition` and `Checkpoint`

```ts
const Checkpoint = z.object({
  description: z.string(),          // appears verbatim in the timeout message
  condition: ConditionMatcher,      // the same language the detectors use
  timeoutMs: z.number().int().default(10000),
});

// There is no separate Assertion union. ConditionMatcher, defined in
// docs/ERROR_TAXONOMY.md section 5, carries elementPresent, textMatches, urlMatches,
// httpStatus, dialogPresent, outputResolvable, and the combinators all, any and not.
// One language, one evaluator, one set of tests.
```

`urlMatches` alone is never sufficient and the schema does not enforce that, but the generalizer will not emit a checkpoint whose condition is only a URL match. In a frameset app the URL frequently does not change at all when the state does. Two conditions that both have to hold are an `all`, and either or is an `any`.

### `policy`

```ts
const CapabilityPolicy = z.object({
  maxEffect: z.enum(['read', 'write']),
  requiresApproval: z.boolean(),
  allowUnattendedReplay: z.boolean(),
  maxStepDurationMs: z.number().int(),
  maxTotalDurationMs: z.number().int(),
});
```

The capability declares its own ceiling and the global allowlist declares the system ceiling. The effective policy is the intersection, so a capability can be more restrictive than the system but never less. That is the only safe direction for this to compose.

There is no origin here and no switch for re authentication. An origin belongs to the deployment a capability runs against, so it comes from config and the global allowlist. Re authentication mid run was cut along with session expiry, so a lapsed session ends the run as `SessionExpired`.

### `provenance`

```ts
const Provenance = z.object({
  recordedAt: z.string().datetime(),
  discoveryRunId: z.string(),        // pointer into evidence/, not the transcript itself
  model: z.string(),
  promptVersion: z.string(),
  recorderVersion: z.string(),
  generalizerVersion: z.string(),
  redactionApplied: z.literal(true), // a marker that the writer ran its scan
  derivedFrom: z.object({ id: z.string(), version: z.string() }).optional(),
});
```

`redactionApplied` as a literal `true` records that the writer ran its scan. It is a marker and not the enforcement, because nothing stops a caller setting a boolean. The enforcement is `CapabilityStore`, which scans the serialised artifact for declared input values and redactor matches and refuses to write on a hit. Claiming a type could enforce it would be the kind of safety story that reads well and protects nothing.

`promptVersion` and `generalizerVersion` exist because when an artifact turns out to be badly recorded, the first question is which version of our own pipeline produced it.

### `lifecycle`

```ts
const Lifecycle = z.object({
  status: z.enum(['draft', 'approved', 'deprecated']),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  supersededBy: z.string().optional(),
});
```

A freshly discovered artifact is `draft`. Unattended replay requires `approved`. This is a three line gate in the executor and it is the difference between a demo and something you would let near a core banking system. Approval is written by `npm run review` and lands as a commit, so who approved what is answerable from git history.

Nothing counts replays, drift or failures across runs. Each result reports its own drift and recoveries, and aggregating them is a cut. If counters are ever added they live beside the artifact and never inside it, because an artifact that rewrites itself on every run is not versioned.

## 4. Templating

`TemplateExpr` is a string with `{{...}}` references. Scope is restricted to `inputs.*`, `outputs.*` for values already extracted earlier in the flow, and `env.*` for a small explicit allowlist of non secret runtime values. There is no expression language, no arithmetic, no function calls. Resolution is a pure function, exhaustively unit tested, and an unresolved reference is a hard failure before any action is taken.

The restriction is deliberate. The moment templates become Turing complete the artifact stops being reviewable, and reviewability is a requirement.

Locator strategies are templated too. A derived `text` strategy that matched a search result row would otherwise commit a member ID into a file that goes to a public repository. The generalizer parameterises any strategy text that equals a declared input value, and drops any strategy whose text trips the redactor and cannot be parameterised.

Navigate paths and `urlMatches` patterns are templated the same way, by the canonicalise transform. A recorded path of `/member/10001` is stored as `/member/{{inputs.memberId}}`. Without that, a replay for any other member would open the wrong member's record, and the writer scan would refuse the artifact first, so discovery would fail rather than produce a dangerous artifact.

## 5. Storage and versioning

```
capabilities/<id>@<version>.json
```

One file per version. JSON, pretty printed, stable key order, committed to git. Git gives us history, diffs, and review on a file a compliance team could actually read in a pull request. A database buys nothing at this scale and costs reviewability.

Version rules are conventions, applied by a person at review. Nothing classifies a diff automatically.

* **Patch.** A locator bundle gains a strategy, a timeout changes, a description improves.
* **Minor.** A step is added, or an optional input or a new declared outcome appears. Existing callers keep working. The negative probe review applies a minor bump by rule, because it only ever adds a declared outcome.
* **Major.** Inputs, outputs, or the success condition change shape. Existing callers break.

Replay checks `schemaVersion` for engine compatibility and refuses to run an artifact from a future schema. Callers pin `id@major` and get patches for free.

### Overlays, designed and not built

```ts
const Overlay = z.object({
  schemaVersion: z.literal('1.0.0'),
  capabilityId: z.string(),
  variant: z.string(),                 // 'vendorX-v9' | 'tenant-acme'
  version: z.string().regex(SEMVER),
  appliesTo: z.string(),               // semver range over base versions, '^1.2.0'
  extends: z.string().optional(),      // parent variant name, resolved first

  steps: z.record(z.object({           // keyed by step id, never by index
    target: LocatorBundle.optional(),
    value: TemplateExpr.optional(),
    onCondition: z.array(ConditionRule).optional(),
  })).default({}),

  outputs: z.record(z.object({ source: OutputSource })).default({}),
  outcomes: z.record(z.object({ detect: ConditionMatcher })).default({}),
});
```

An overlay carries bindings and never contracts. It can say where this tenant renders the balance. It cannot say that this tenant returns a different type, a different name, or a different set of steps, because a tenant that changes the contract has a different capability and should be forced to admit it. `appliesTo` is what stops an overlay written against `1.2.x` from silently merging into a `2.0.0` base whose steps moved. See ADR 0015.

Nothing in this repository loads or merges an overlay. The design is here because requirement 3.7 asks how reuse across tenants would work, and this is the answer. `REPORT.md` section 4 says the same.

## 6. Worked example

`capabilities/member.readSavingsBalance@1.1.0.json`, abbreviated. Version `1.0.0` came from the discovery run. `1.1.0` added the declared outcomes through the negative probe review in ADR 0018.

```json
{
  "schemaVersion": "1.0.0",
  "id": "member.readSavingsBalance",
  "version": "1.1.0",
  "name": "Read member savings balance",
  "description": "Looks up a member by ID and returns the current balance of their primary savings account.",
  "app": { "appId": "meridian-core", "vendor": "meridian", "entryPath": "/servicing" },
  "surface": { "kind": "legacy-web", "minDriverVersion": "1.0.0", "capabilitiesRequired": ["frames"] },
  "inputs": [
    { "name": "memberId", "type": "string", "required": true, "sensitivity": "pii",
      "description": "Institution member number", "constraints": { "pattern": "^[0-9]{5,10}$" } }
  ],
  "outputs": [
    { "name": "savingsBalance", "type": "money", "required": true, "sensitivity": "pii",
      "description": "Current balance of the primary savings account",
      "source": { "stepId": "openMemberDetail", "target": { "...": "balance cell bundle" },
                  "attribute": "text", "parse": { "kind": "money", "currency": "USD" } } }
  ],
  "outcomes": [
    { "code": "MEMBER_NOT_FOUND", "terminal": true, "provenance": "manual",
      "description": "No member exists with the supplied ID.",
      "detect": { "kind": "textMatches", "target": { "...": "results banner bundle" }, "pattern": "No records found" } },
    { "code": "ACCOUNT_RESTRICTED", "terminal": true, "provenance": "manual",
      "description": "The member exists but the operator lacks permission to view balances.",
      "detect": { "kind": "textMatches", "target": { "...": "error region bundle" }, "pattern": "not authorized" } }
  ],
  "steps": [
    { "id": "openSearch", "index": 0, "intent": "Open the member search screen inside the content frame",
      "action": { "kind": "navigate", "path": "/servicing/search", "framePath": ["content"] },
      "effect": "read", "idempotent": true, "retry": { "attempts": 2, "backoffMs": 500 }, "timeoutMs": 15000,
      "postcondition": { "description": "Search form is present in the content frame",
        "condition": { "kind": "elementPresent", "target": { "...": "member id field bundle" } } } },
    { "id": "fillMemberId", "index": 1, "intent": "Enter the member ID",
      "action": { "kind": "fill" }, "value": "{{inputs.memberId}}",
      "target": { "framePath": ["content"], "matchPolicy": "unique", "describedAs": "Member ID input",
        "strategies": [
          { "kind": "anchor-relative", "anchor": { "kind": "text", "text": "Member ID", "exact": false, "confidence": 0.8 },
            "relation": "sameRow", "role": "textbox", "confidence": 0.8 },
          { "kind": "anchor-relative", "anchor": { "kind": "role-name", "role": "heading", "name": "Member Search", "exact": true, "confidence": 0.9 },
            "relation": "firstBelow", "role": "textbox", "confidence": 0.6 },
          { "kind": "structural", "path": "form#srch >> tr:nth-child(2) >> input", "confidence": 0.4 }
        ] },
      "effect": "read", "idempotent": true, "retry": { "attempts": 2, "backoffMs": 250 }, "timeoutMs": 10000,
      "postcondition": { "description": "Member ID field holds the supplied value",
        "condition": { "kind": "textMatches", "target": { "...": "member id field bundle" }, "pattern": "^{{inputs.memberId}}$" } } },
    { "id": "submitSearch", "index": 2, "intent": "Submit the member search form",
      "action": { "kind": "click" }, "target": { "...": "search button bundle" },
      "effect": "read", "idempotent": false, "retry": { "attempts": 0 }, "timeoutMs": 15000,
      "postcondition": { "description": "A result row for the member is present",
        "condition": { "kind": "elementPresent", "target": { "...": "result row bundle" } } } },
    { "id": "openMemberDetail", "index": 3, "intent": "Open the member detail screen",
      "action": { "kind": "click" }, "target": { "...": "result row link bundle, text {{inputs.memberId}}" },
      "effect": "read", "idempotent": true, "retry": { "attempts": 2, "backoffMs": 250 }, "timeoutMs": 15000,
      "postcondition": { "description": "The accounts table is present",
        "condition": { "kind": "elementPresent", "target": { "...": "balance cell bundle" } } } }
  ],
  "successCondition": {
    "description": "Member detail screen shows a savings balance",
    "condition": { "kind": "all", "of": [
      { "kind": "elementPresent", "target": { "...": "balance cell bundle" } },
      { "kind": "outputResolvable", "outputName": "savingsBalance" }
    ] }
  },
  "policy": { "maxEffect": "read", "requiresApproval": true, "allowUnattendedReplay": false,
              "maxStepDurationMs": 20000, "maxTotalDurationMs": 120000 },
  "provenance": { "recordedAt": "2026-09-11T00:00:00Z", "discoveryRunId": "run_01J...",
                  "model": "from ANTHROPIC_MODEL at record time", "promptVersion": "1.0.0",
                  "recorderVersion": "1.0.0", "generalizerVersion": "1.0.0", "redactionApplied": true },
  "lifecycle": { "status": "draft" }
}
```

Four details in that example are there because the first draft of this document got them wrong.

`entryPath` is `/servicing`, the frameset shell, and the `navigate` step names its `framePath`. Pointing the top level document straight at `/servicing/search` replaces the frameset, after which every `framePath: ["content"]` in the artifact resolves to nothing.

The member ID bundle does not rely on the text `Member ID` alone. The `relabel` fault renames exactly that label, so the second strategy anchors on the screen heading instead. Under that fault the second strategy is the one that wins, and the result records the degradation as drift.

`submitSearch` is `read` and not idempotent. It is a POST, so repeating it is not free, but nobody should have to approve a search.

Every acting step carries a postcondition, because the executor races that postcondition against the outcome detectors and needs both sides of the race to exist.

## 7. What the schema deliberately does not have

* **Conditional branching and loops.** A capability is one flow with declared outcomes. Branching belongs to the calling agent, which composes capabilities. Putting control flow in the artifact turns it into a programming language and destroys reviewability.
* **Embedded credentials or a login flow.** Authentication is a session concern handled by the `SessionBroker` before replay starts.
* **The model transcript.** It lives in evidence, referenced by `discoveryRunId`.
* **Timing data from the recording.** Record time durations are a property of that machine on that day. Waits are conditions, never replayed durations.
* **Operational counters.** Nothing aggregates replays, drift or failures across runs. If it did, it would live beside the artifact, never inside it.
* **A visual locator strategy.** Cut by ADR 0013. Nothing in this system would ever execute one, and a schema field nothing executes is a guess dressed as a design.
* **An origin or a host.** They come from config at invocation. An artifact carrying one institution host could not be reused by another institution, which is the whole point of the artifact.
