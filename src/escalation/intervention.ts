import type { EscalationReason } from '../core/outcome/result.js';
import type { KnownValue, Redactor } from '../core/redaction/redactor.js';
import type { Clock } from '../runtime/clock.js';
import type { IdProvider } from '../runtime/ids.js';

// The intervention request of docs/ESCALATION.md section 4. The brief asks for enough context to
// act on it, which capability or goal, the current step, the state or a screenshot, and why it
// stopped, so every one of those is a required field. Everything written for a person is
// redacted here, because the payload is served to a browser over HTTP.
//
// The store is in memory with no journal. A run owns its browser, so a restored claim would
// point at a session that died with the process, which is worse than no claim. Evidence is the
// durable record, and this interface is the seam a real deployment would replace.

export type InterventionState = 'open' | 'claimed' | 'released' | 'aborted' | 'expired';

export interface ActionSummary {
  readonly at: string;
  readonly kind: string;
  readonly describedAs: string | null;
  readonly ok: boolean;
}

export interface InterventionRequest {
  readonly id: string;
  readonly createdAt: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly phase: 'discovery' | 'replay';
  readonly capability?: { readonly id: string; readonly version: string };
  readonly goal?: string;
  readonly reason: EscalationReason;
  readonly explanation: string;
  readonly atStep: { readonly id: string; readonly index: number; readonly intent: string } | null;
  readonly state: {
    readonly url: string;
    readonly framePath: readonly string[];
    readonly screenshotRef: string;
    readonly snapshotRef: string;
    readonly recentActions: readonly ActionSummary[];
  };
  readonly suggestedAction: string;
  readonly consoleUrl: string;
  readonly expiresAt: string;
}

export interface InterventionStore {
  add(request: InterventionRequest): InterventionRequest;
  get(id: string): InterventionRequest | null;
  list(): readonly InterventionRequest[];
  status(id: string): InterventionState | null;
  // A release may carry an approval, which is a person approving one action rather than
  // performing it, see docs/ESCALATION.md section 5.
  settle(id: string, state: InterventionState, details?: { readonly approved?: boolean }): void;
  // How a blocked run learns that a person answered. Returns the way to stop listening.
  subscribe(listener: (id: string, state: InterventionState, details: { readonly approved: boolean }) => void): () => void;
}

export interface RaiseContext {
  readonly store: InterventionStore;
  readonly clock: Clock;
  readonly ids: IdProvider;
  readonly redactor: Redactor;
  readonly known: readonly KnownValue[];
  readonly sessionId: string;
  readonly runId: string;
  readonly phase: 'discovery' | 'replay';
  readonly reason: EscalationReason;
  // Written for a bank operator rather than an engineer, and redacted like everything else.
  readonly explanation: string;
  readonly suggestedAction: string;
  readonly capability?: { readonly id: string; readonly version: string };
  readonly goal?: string;
  readonly atStep?: { readonly id: string; readonly index: number; readonly intent: string };
  readonly url: string;
  readonly framePath: readonly string[];
  readonly screenshotRef: string;
  readonly snapshotRef: string;
  readonly recentActions: readonly ActionSummary[];
  readonly consoleBaseUrl: string;
  readonly claimTimeoutMs: number;
}

export function createInterventionStore(): InterventionStore {
  const items = new Map<string, { readonly request: InterventionRequest; readonly state: InterventionState }>();
  const listeners = new Set<(id: string, state: InterventionState, details: { readonly approved: boolean }) => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    add: (request) => {
      items.set(request.id, { request, state: 'open' });
      return request;
    },
    get: (id) => items.get(id)?.request ?? null,
    list: () => [...items.values()].filter((entry) => entry.state === 'open').map((entry) => entry.request),
    status: (id) => items.get(id)?.state ?? null,
    settle: (id, state, details) => {
      const entry = items.get(id);
      if (entry === undefined) throw new TypeError(`There is no intervention ${id} to settle.`);
      items.set(id, { request: entry.request, state });
      for (const listener of [...listeners]) listener(id, state, { approved: details?.approved === true });
    },
  };
}

export function raiseIntervention(context: RaiseContext): InterventionRequest {
  const clean = (text: string): string => context.redactor.text(text, { known: context.known });
  const now = context.clock.now();
  const id = context.ids.next('int');

  return context.store.add({
    id,
    createdAt: now.toISOString(),
    sessionId: context.sessionId,
    runId: context.runId,
    phase: context.phase,
    ...(context.capability === undefined ? {} : { capability: context.capability }),
    ...(context.goal === undefined ? {} : { goal: clean(context.goal) }),
    reason: context.reason,
    explanation: clean(context.explanation),
    atStep: context.atStep === undefined ? null : { ...context.atStep, intent: clean(context.atStep.intent) },
    state: {
      url: clean(context.url),
      framePath: [...context.framePath],
      screenshotRef: context.screenshotRef,
      snapshotRef: context.snapshotRef,
      recentActions: context.recentActions.map((action) => ({ ...action, describedAs: action.describedAs === null ? null : clean(action.describedAs) })),
    },
    suggestedAction: clean(context.suggestedAction),
    consoleUrl: `${context.consoleBaseUrl}/interventions/${id}`,
    // A session is never held open forever. When this passes with no claim the run ends as
    // escalated with unclaimed, see docs/ESCALATION.md section 2.
    expiresAt: new Date(now.getTime() + context.claimTimeoutMs).toISOString(),
  });
}
