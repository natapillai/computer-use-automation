import { Capability, type CapabilityInput } from '../core/capability/schema.js';
import { deriveBundle } from '../core/locator/derive.js';
import type { LocatorBundle } from '../core/locator/schema.js';
import { sensitiveFields, type AppProfile } from '../core/policy/profile.js';
import type { Redactor } from '../core/redaction/redactor.js';
import type { Observation } from '../core/surfaceModel/types.js';
import { walkNodes } from '../core/surfaceModel/tree.js';

// The negative probe review, ADR 0018. A happy path discovery run never sees the not found
// banner, so a discovered artifact declares no outcomes and its first unhappy replay would
// report a failure. A reviewer names the outcome and points at the banner by what it says. The
// detector is derived from that real element, so ADR 0013 holds here too and nobody writes a
// selector. Naming the outcome stays a human decision, because it is a product decision.

export interface OutcomeDecision {
  readonly code: string;
  readonly description: string;
  readonly terminal: boolean;
  // What the reviewer saw on the screen the probe stopped on. It selects the element, and the
  // detector is derived from that element, never from this text.
  readonly elementText: string;
}

export interface OutcomeProbeContext {
  readonly inputs: Readonly<Record<string, string>>;
  readonly profile: AppProfile;
  readonly redactor: Redactor;
}

export type OutcomeDeclaration =
  | { readonly ok: true; readonly capability: Capability; readonly detector: LocatorBundle }
  | {
      readonly ok: false;
      readonly failure: 'NoMatchingElement' | 'AmbiguousElement' | 'NoUniqueStrategy' | 'OutcomeAlreadyDeclared' | 'CapabilityInvalid';
      readonly detail: string;
    };

// A review only ever adds a declared outcome, so existing callers keep working and the bump is
// a minor by rule, see docs/ARTIFACT_SCHEMA.md section 5.
export function minorBump(version: string): string {
  const [major = '0', minor = '0'] = version.split('.');
  return `${major}.${Number(minor) + 1}.0`;
}

export function declareOutcome(capability: Capability, observation: Observation, decision: OutcomeDecision, context: OutcomeProbeContext): OutcomeDeclaration {
  if (capability.outcomes.some((outcome) => outcome.code === decision.code)) {
    return { ok: false, failure: 'OutcomeAlreadyDeclared', detail: `${capability.id} already declares ${decision.code}.` };
  }

  // A refusal counts elements and never repeats the text, because a banner can carry member data.
  const wanted = collapse(decision.elementText);
  const matches = [...walkNodes(observation.root)].filter((node) => collapse(node.name).includes(wanted) || collapse(node.value ?? '').includes(wanted));
  const [node] = matches;
  if (node === undefined) return { ok: false, failure: 'NoMatchingElement', detail: 'Nothing on the screen the probe stopped on carries the text the review names.' };
  if (matches.length > 1) return { ok: false, failure: 'AmbiguousElement', detail: `${matches.length} elements carry the text the review names, so it does not name one banner.` };

  const derived = deriveBundle(observation, node.ref, {
    inputs: context.inputs,
    sensitive: sensitiveFields(context.profile, observation),
    redacts: (text) => context.redactor.text(text, { known: [] }) !== text,
  });
  if (!derived.ok) return { ok: false, failure: 'NoUniqueStrategy', detail: `No strategy found that ${node.role} and nothing else.` };

  const candidate: CapabilityInput = {
    ...capability,
    version: minorBump(capability.version),
    outcomes: [
      ...capability.outcomes,
      { code: decision.code, description: decision.description, terminal: decision.terminal, detect: { kind: 'elementPresent', target: derived.bundle }, provenance: 'manual' },
    ],
    provenance: { ...capability.provenance, derivedFrom: { id: capability.id, version: capability.version } },
    lifecycle: { status: 'draft' },
  };

  const parsed = Capability.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, failure: 'CapabilityInvalid', detail: parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('. ') };
  }
  return { ok: true, capability: parsed.data, detector: derived.bundle };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
