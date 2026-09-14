import type { ControlToken } from '../control/controlToken.js';
import { authorize, type AuthorizationDecision, type PolicyContext } from '../core/policy/authorize.js';
import type { Resolution } from '../core/locator/resolve.js';
import type { LocatorBundle, LocatorStrategy } from '../core/locator/schema.js';
import type { ActionResult, Observation, ResolvedAction } from '../core/surfaceModel/types.js';
import type { SurfaceDriver } from './types.js';

export interface GuardedAction {
  readonly action: ResolvedAction;
  readonly framePath: readonly string[];
  readonly stepId: string;
  readonly effect: 'read' | 'write';
  readonly targetKey: string | null;
}

export type GuardedOutcome =
  | { readonly kind: 'performed'; readonly result: ActionResult }
  | { readonly kind: 'denied'; readonly decision: Extract<AuthorizationDecision, { verdict: 'deny' }> }
  | { readonly kind: 'confirm'; readonly decision: Extract<AuthorizationDecision, { verdict: 'confirm' }> };

export interface GuardedSurface {
  readonly sessionId: string;
  observe(): Promise<Observation>;
  match(strategy: LocatorStrategy, framePath: readonly string[]): Promise<readonly string[]>;
  resolve(bundle: LocatorBundle, control: ControlToken): Promise<Resolution>;
  perform(request: GuardedAction, control: ControlToken): Promise<GuardedOutcome>;
}

export interface GuardedSurfaceOptions {
  readonly driver: SurfaceDriver;
  readonly policy: PolicyContext;
  readonly runId: string;
  readonly baseUrl: string;
}

// The only place authorize is called, see docs/SAFETY.md section 1. Discovery and replay
// hold this and never the driver, so bypassing policy means editing the wiring rather
// than forgetting a call. A denied or confirmed action never reaches the driver.
export function createGuardedSurface(options: GuardedSurfaceOptions): GuardedSurface {
  const { driver, policy, runId, baseUrl } = options;

  // A navigate is judged by where it goes. Anything else is judged by the live url of
  // the frame it lands in. A url that cannot be worked out is empty, which authorize denies.
  const targetUrl = async (request: GuardedAction): Promise<string> => {
    const { action } = request;
    if (action.kind !== 'navigate') return (await driver.frameUrl(request.framePath)) ?? '';
    try {
      return new URL(action.path, baseUrl).href;
    } catch {
      return '';
    }
  };

  return {
    sessionId: driver.sessionId,
    observe: () => driver.observe(),
    match: (strategy, framePath) => driver.match(strategy, framePath),
    resolve: (bundle, control) => driver.resolve(bundle, control),
    perform: async (request, control) => {
      const decision = authorize(
        {
          kind: request.action.kind,
          url: await targetUrl(request),
          runId,
          stepId: request.stepId,
          targetKey: request.targetKey,
          effect: request.effect,
        },
        policy,
      );
      switch (decision.verdict) {
        case 'deny':
          return { kind: 'denied', decision };
        case 'confirm':
          return { kind: 'confirm', decision };
        case 'allow':
          return { kind: 'performed', result: await driver.act(request.action, control) };
      }
    },
  };
}
