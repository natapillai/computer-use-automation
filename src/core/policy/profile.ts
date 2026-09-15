import { z } from 'zod';
import { Sensitivity } from '../capability/schema.js';
import { LocatorStrategy } from '../locator/schema.js';
import { ConditionMatcher } from '../outcome/condition.js';
import { evaluateCondition, type EvaluationContext } from '../outcome/evaluate.js';
import { higherSensitivity } from '../redaction/sensitivity.js';
import { matchStrategy } from '../surfaceModel/match.js';
import type { Observation } from '../surfaceModel/types.js';
import type { Allowlist } from './allowlist.js';
import { checkUrl } from './authorize.js';
import { globToRegExp } from './glob.js';

// The app profile, profiles/<appId>.json. Product knowledge held once per vendor product,
// see ERROR_TAXONOMY section 5 and ADR 0014. The route and method table classifies effect
// and idempotency, the field map marks sensitive cells, and the conditions are true of the
// whole application.

const Route = z.strictObject({
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
  path: z.string().startsWith('/'),
  effect: z.enum(['read', 'write']),
  idempotent: z.boolean(),
  note: z.string().min(1).optional(),
});

const SensitiveField = z.strictObject({
  describedAs: z.string().min(1),
  framePath: z.array(z.string()),
  sensitivity: Sensitivity,
  strategy: LocatorStrategy,
});

const ProfileCondition = z.strictObject({
  when: ConditionMatcher,
  classify: z.enum(['recoverable', 'escalate', 'failure']),
  code: z.string().min(1),
});

export const AppProfile = z.strictObject({
  appId: z.string().min(1),
  vendor: z.string().min(1),
  routes: z.array(Route).min(1),
  fields: z.array(SensitiveField),
  conditions: z.array(ProfileCondition),
});

export type AppProfile = z.output<typeof AppProfile>;
export type FieldSensitivity = z.output<typeof Sensitivity>;

export interface RouteClass {
  readonly effect: 'read' | 'write';
  readonly idempotent: boolean;
  readonly classified: boolean;
}

export interface StepEffect {
  readonly stepId: string;
  readonly effect: 'read' | 'write';
}

export type RequestDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly rule: 'url' | 'origin' | 'deniedPath' | 'path' | 'effect' | 'unclassified'; readonly reason: string };

export interface RequestContext {
  readonly allowlist: Allowlist;
  readonly profile: AppProfile;
  readonly step: StepEffect | null;
  readonly method: string;
  readonly url: string;
}

export interface ProfileClassification {
  readonly classify: 'recoverable' | 'escalate' | 'failure';
  readonly code: string;
}

// A route the profile does not list is a write that is not idempotent, so an action nobody
// classified fails closed. See ADR 0014.
export function classifyRequest(profile: AppProfile, method: string, url: string): RouteClass {
  const path = pathnameOf(url);
  const verb = method.toUpperCase();
  const route = path === null ? undefined : profile.routes.find((candidate) => candidate.method === verb && globToRegExp(candidate.path).test(path));
  return route === undefined ? { effect: 'write', idempotent: false, classified: false } : { effect: route.effect, idempotent: route.idempotent, classified: true };
}

// The network guard's decision for one request, per ADR 0014 as amended on 2026-09-15.
// The allowlist always applies. While a step runs, the profile must classify the request,
// and a read step may not send a write. Outside a step, including the window a person holds
// control, only the allowlist applies. A reason never repeats the url.
export function authorizeRequest(context: RequestContext): RequestDecision {
  const url = checkUrl(context.allowlist, context.url);
  if (!url.allowed) return url;
  if (context.step === null) return { allowed: true };

  const route = classifyRequest(context.profile, context.method, context.url);
  if (!route.classified) {
    return { allowed: false, rule: 'unclassified', reason: 'The app profile does not classify this request, so it is refused while a step runs.' };
  }
  if (context.step.effect === 'read' && route.effect === 'write') {
    return { allowed: false, rule: 'effect', reason: 'The app profile classifies this request as a write and the running step declares a read.' };
  }
  return { allowed: true };
}

// Refs of the nodes the profile marks sensitive in this observation. What masks a member
// name in a screenshot, because no pattern finds a name.
export function sensitiveFields(profile: AppProfile, observation: Observation): ReadonlyMap<string, FieldSensitivity> {
  const fields = new Map<string, FieldSensitivity>();
  for (const field of profile.fields) {
    for (const ref of matchStrategy(observation, field.strategy, field.framePath)) {
      const already = fields.get(ref);
      fields.set(ref, already === undefined ? field.sensitivity : higherSensitivity(already, field.sensitivity));
    }
  }
  return fields;
}

// The first profile condition that holds, in the order the profile lists them.
export async function profileCondition(profile: AppProfile, context: EvaluationContext): Promise<ProfileClassification | null> {
  for (const condition of profile.conditions) {
    if ((await evaluateCondition(condition.when, context)).holds) return { classify: condition.classify, code: condition.code };
  }
  return null;
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}
