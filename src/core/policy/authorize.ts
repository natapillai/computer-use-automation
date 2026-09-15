import type { Allowlist } from './allowlist.js';
import { globToRegExp } from './glob.js';

export interface ProposedAction {
  readonly kind: string;
  readonly url: string;
  readonly runId: string;
  readonly stepId: string;
  readonly targetKey: string | null;
  readonly effect: 'read' | 'write';
}

export interface Grant {
  readonly runId: string;
  readonly stepId: string;
  readonly targetKey: string | null;
}

export interface GrantLedger {
  issue(grant: Grant): void;
  consume(grant: Grant): boolean;
}

export interface PolicyContext {
  readonly allowlist: Allowlist;
  readonly phase: 'discovery' | 'replay';
  readonly capabilityStatus: 'draft' | 'approved' | 'deprecated' | null;
  readonly allowUnattendedReplay: boolean;
  readonly grants: GrantLedger;
}

export type AuthorizationDecision =
  | { readonly verdict: 'allow' }
  | { readonly verdict: 'deny'; readonly rule: string; readonly reason: string }
  | { readonly verdict: 'confirm'; readonly rule: string; readonly reason: string; readonly effect: 'write' };

export type UrlCheck =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly rule: 'url' | 'origin' | 'deniedPath' | 'path'; readonly reason: string };

// A grant is one approval for one write, bound to a run, a step and a resolved target,
// and consumed the first time it is used. Without it a resumed step would re authorize,
// be told to confirm again, and escalate forever. See ADR 0014.
export function createGrantLedger(): GrantLedger {
  const open = new Set<string>();
  const keyOf = (grant: Grant): string => JSON.stringify([grant.runId, grant.stepId, grant.targetKey]);

  return {
    issue: (grant) => {
      open.add(keyOf(grant));
    },
    consume: (grant) => open.delete(keyOf(grant)),
  };
}

const deny = (rule: string, reason: string): AuthorizationDecision => ({ verdict: 'deny', rule, reason });

// The single choke point. Fail closed at every branch. A reason never repeats the URL
// or the path, because a path can carry a member ID.
export function authorize(action: ProposedAction, context: PolicyContext): AuthorizationDecision {
  const { allowlist } = context;

  if (allowlist.actions.denied.includes(action.kind) || !allowlist.actions.allowed.includes(action.kind)) {
    return deny('action', 'This action kind is not permitted by the allowlist.');
  }

  const url = checkUrl(allowlist, action.url);
  if (!url.allowed) return deny(url.rule, url.reason);

  if (action.effect === 'read') {
    return { verdict: 'allow' };
  }
  if (context.phase === 'replay' && context.capabilityStatus === 'approved' && context.allowUnattendedReplay) {
    return { verdict: 'allow' };
  }
  if (context.grants.consume({ runId: action.runId, stepId: action.stepId, targetKey: action.targetKey })) {
    return { verdict: 'allow' };
  }
  return {
    verdict: 'confirm',
    rule: 'effect',
    reason: 'This step writes to the system of record and needs a person to approve it.',
    effect: 'write',
  };
}

// The origin and path rules on their own. The network guard applies them to every
// request the browser makes, including while a person holds control, and it is not an
// authorization of an action, so it does not go through authorize.
export function checkUrl(allowlist: Allowlist, text: string): UrlCheck {
  const url = parseUrl(text);
  if (url === null) {
    return { allowed: false, rule: 'url', reason: 'The target is a URL that could not be parsed.' };
  }

  // Exact scheme, host and port. A wildcard host in a multitenant system is not an allowlist.
  const origin = allowlist.origins.find((candidate) => candidate.pattern === url.origin);
  if (origin === undefined) {
    return { allowed: false, rule: 'origin', reason: 'The origin is not in the allowlist.' };
  }

  const path = url.pathname;
  if (origin.deniedPaths.some((glob) => globToRegExp(glob).test(path))) {
    return { allowed: false, rule: 'deniedPath', reason: 'The path is denied by the allowlist.' };
  }
  if (!origin.allowedPaths.some((glob) => globToRegExp(glob).test(path))) {
    return { allowed: false, rule: 'path', reason: 'No allowed path pattern covers this path.' };
  }
  return { allowed: true };
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
