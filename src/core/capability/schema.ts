import { z } from 'zod';
import { LocatorBundle } from '../locator/schema.js';
import { ConditionMatcher } from '../outcome/condition.js';
import { capabilityIssues } from './refinements.js';

// The executable form of docs/ARTIFACT_SCHEMA.md. Structure lives here. Rules that
// relate one field to another live in refinements.ts as a pure function.

export const SUPPORTED_SCHEMA_VERSION = '1.0.0';

const Semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a semantic version such as 1.0.0');
const Identifier = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'must be lower camel case');

export const Sensitivity = z.enum(['public', 'internal', 'pii', 'secret']);

// A string with {{inputs.x}}, {{outputs.x}} or {{env.x}} references and nothing else.
export const TemplateExpr = z.string();

export const AppBinding = z.strictObject({
  appId: z.string().min(1),
  vendor: z.string().min(1),
  productVersion: z.string().min(1).optional(),
  entryPath: z.string().startsWith('/'),
});

export const SurfaceRequirement = z.strictObject({
  kind: z.enum(['web', 'legacy-web', 'desktop']),
  minDriverVersion: Semver,
  capabilitiesRequired: z.array(z.enum(['frames', 'dialogs', 'fileUpload', 'clipboard'])),
});

export const ParamSpec = z.strictObject({
  name: Identifier,
  type: z.enum(['string', 'number', 'boolean', 'date', 'enum']),
  enumValues: z.array(z.string().min(1)).min(1).optional(),
  required: z.boolean(),
  description: z.string().min(1),
  example: z.string().optional(),
  sensitivity: Sensitivity,
  constraints: z
    .strictObject({
      pattern: z.string().min(1).optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
});

export const ParseRule = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('money'), currency: z.string().regex(/^[A-Z]{3}$/) }),
  z.strictObject({ kind: z.literal('number') }),
]);

export const OutputSource = z.strictObject({
  stepId: Identifier,
  target: LocatorBundle,
  attribute: z.enum(['text', 'value', 'ariaValue', 'href', 'checked']).default('text'),
  parse: ParseRule.optional(),
});

export const OutputSpec = z.strictObject({
  name: Identifier,
  type: z.enum(['string', 'number', 'boolean', 'date', 'money', 'object', 'array']),
  description: z.string().min(1),
  sensitivity: Sensitivity,
  required: z.boolean(),
  source: OutputSource,
});

export const Checkpoint = z.strictObject({
  description: z.string().min(1),
  condition: ConditionMatcher,
  timeoutMs: z.number().int().positive().default(10_000),
});

export const ConditionRule = z.strictObject({
  when: ConditionMatcher,
  classify: z.enum(['business_outcome', 'recoverable', 'failure', 'escalate']),
  code: z.string().min(1),
  captureData: z.array(OutputSpec).optional(),
});

export const BusinessOutcomeSpec = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'must be upper snake case'),
  description: z.string().min(1),
  terminal: z.boolean(),
  detect: ConditionMatcher,
  data: z.array(OutputSpec).optional(),
  provenance: z.enum(['model', 'manual']).default('manual'),
});

export const RetryPolicy = z.strictObject({
  attempts: z.number().int().min(0).max(5),
  backoffMs: z.number().int().positive().default(500),
});

// Only verbs that act. waitFor, extract and assert are executor operations, and there
// is no extract step because outputs carry their own bundles.
export const StepAction = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('navigate'), path: TemplateExpr.pipe(z.string().startsWith('/')), framePath: z.array(z.string()) }),
  z.strictObject({ kind: z.literal('click') }),
  z.strictObject({ kind: z.literal('fill') }),
  z.strictObject({ kind: z.literal('select') }),
  z.strictObject({ kind: z.literal('press'), key: z.string().min(1) }),
  z.strictObject({ kind: z.literal('hover') }),
  z.strictObject({ kind: z.literal('scroll') }),
  z.strictObject({ kind: z.literal('dismiss') }),
]);

export const Step = z.strictObject({
  id: Identifier,
  index: z.number().int().nonnegative(),
  intent: z.string().min(1),
  action: StepAction,
  target: LocatorBundle.optional(),
  value: TemplateExpr.optional(),
  precondition: Checkpoint.optional(),
  postcondition: Checkpoint,
  effect: z.enum(['read', 'write']),
  idempotent: z.boolean(),
  sensitive: z.boolean().default(false),
  retry: RetryPolicy,
  timeoutMs: z.number().int().positive().default(15_000),
  onCondition: z.array(ConditionRule).default([]),
  provenance: z.enum(['model', 'manual']).default('model'),
});

export const CapabilityPolicy = z.strictObject({
  maxEffect: z.enum(['read', 'write']),
  requiresApproval: z.boolean(),
  allowUnattendedReplay: z.boolean(),
  maxStepDurationMs: z.number().int().positive(),
  maxTotalDurationMs: z.number().int().positive(),
});

export const Provenance = z.strictObject({
  recordedAt: z.iso.datetime(),
  discoveryRunId: z.string().min(1),
  model: z.string().min(1),
  promptVersion: Semver,
  recorderVersion: Semver,
  generalizerVersion: Semver,
  redactionApplied: z.literal(true),
  derivedFrom: z.strictObject({ id: z.string().min(1), version: Semver }).optional(),
});

export const Lifecycle = z.strictObject({
  status: z.enum(['draft', 'approved', 'deprecated']),
  approvedBy: z.string().min(1).optional(),
  approvedAt: z.iso.datetime().optional(),
  supersededBy: z.string().min(1).optional(),
});

const CapabilityShape = z.strictObject({
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, 'must be dotted lower camel case'),
  version: Semver,
  name: z.string().min(1),
  description: z.string().min(1),
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

export type CapabilityShape = z.output<typeof CapabilityShape>;

export const Capability = CapabilityShape.superRefine((capability, ctx) => {
  for (const issue of capabilityIssues(capability)) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] });
  }
});

export type Capability = z.output<typeof Capability>;
export type CapabilityInput = z.input<typeof Capability>;
export type Step = z.output<typeof Step>;
export type OutputSpec = z.output<typeof OutputSpec>;
