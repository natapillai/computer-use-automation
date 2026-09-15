import type { Browser } from 'playwright';
import type { Allowlist } from '../core/policy/allowlist.js';
import { checkUrl, type PolicyContext } from '../core/policy/authorize.js';
import { authorizeRequest, type AppProfile } from '../core/policy/profile.js';
import type { IdProvider } from '../runtime/ids.js';
import { createGuardedSurface, type GuardedSurface } from '../surface/guardedSurface.js';
import { createStepScope } from '../surface/stepScope.js';
import { createWebSurfaceDriver } from '../surface/web/webSurfaceDriver.js';
import { createControlTokens, type SessionControlTokens } from './controlToken.js';

// Owns browser sessions. A session is signed in before it is leased, so no capability
// step ever types a credential and no artifact can hold one. Every lease carries a
// network guard. It refuses any request outside the allowlist, which is the one control
// that still applies while a person holds the session, and while a step runs it enforces
// the app profile against the step's declared effect. See ADR 0008, ADR 0014 as amended
// on 2026-09-15, and docs/SAFETY.md.

export interface FormLogin {
  readonly path: string;
  readonly usernameField: string;
  readonly passwordField: string;
  readonly username: string;
  readonly password: string;
}

export interface SessionBrokerOptions {
  readonly browser: Browser;
  readonly allowlist: Allowlist;
  readonly profile: AppProfile;
  readonly baseUrl: string;
  readonly login: FormLogin;
  readonly ids: IdProvider;
  readonly actionTimeoutMs?: number;
}

export interface LeaseRequest {
  readonly runId: string;
  readonly policy: Omit<PolicyContext, 'allowlist'>;
}

export interface Lease {
  readonly sessionId: string;
  readonly surface: GuardedSurface;
  readonly tokens: SessionControlTokens;
  // The rule behind each request the network guard refused, in order. Never the url.
  refusedRequests(): readonly string[];
  release(): Promise<void>;
}

export type LeaseResult =
  | { readonly ok: true; readonly lease: Lease }
  | { readonly ok: false; readonly failure: 'SurfaceUnavailable'; readonly detail: string };

export interface SessionBroker {
  lease(request: LeaseRequest): Promise<LeaseResult>;
}

const VIEWPORT = { width: 1024, height: 700 };

export function createSessionBroker(options: SessionBrokerOptions): SessionBroker {
  const { browser, allowlist, profile, baseUrl, login, ids } = options;

  const unavailable = (detail: string): LeaseResult => ({ ok: false, failure: 'SurfaceUnavailable', detail });

  return {
    lease: async (request) => {
      // Credentials go nowhere the allowlist does not cover, checked before they are sent.
      const loginUrl = new URL(login.path, baseUrl).href;
      if (!checkUrl(allowlist, loginUrl).allowed) {
        return unavailable('The login path is not covered by the allowlist, so no credentials were sent.');
      }

      const context = await browser.newContext({ viewport: VIEWPORT });
      const scope = createStepScope();
      await context.route('**/*', async (route) => {
        const pending = route.request();
        const decision = authorizeRequest({ allowlist, profile, step: scope.current(), method: pending.method(), url: pending.url() });
        if (decision.allowed) {
          await route.continue();
          return;
        }
        scope.refuse(decision.rule);
        await route.abort('blockedbyclient');
      });

      // Details name what failed and never the account, because they reach logs.
      let signedIn: boolean;
      try {
        const response = await context.request.post(loginUrl, {
          form: { [login.usernameField]: login.username, [login.passwordField]: login.password },
          maxRedirects: 0,
          ...(options.actionTimeoutMs === undefined ? {} : { timeout: options.actionTimeoutMs }),
        });
        signedIn = response.status() < 400 && response.headersArray().some((header) => header.name.toLowerCase() === 'set-cookie');
      } catch {
        await context.close();
        return unavailable('The target app did not answer the login request.');
      }
      if (!signedIn) {
        await context.close();
        return unavailable('The target app refused the login.');
      }

      const page = await context.newPage();
      const sessionId = ids.next('sess');
      const tokens = createControlTokens(sessionId, ids);
      const driver = createWebSurfaceDriver({
        page,
        sessionId,
        control: tokens,
        baseUrl,
        ...(options.actionTimeoutMs === undefined ? {} : { actionTimeoutMs: options.actionTimeoutMs }),
      });

      return {
        ok: true,
        lease: {
          sessionId,
          surface: createGuardedSurface({ driver, policy: { allowlist, ...request.policy }, runId: request.runId, baseUrl, scope }),
          tokens,
          refusedRequests: () => scope.refusals().map((refusal) => refusal.rule),
          release: () => context.close(),
        },
      };
    },
  };
}
