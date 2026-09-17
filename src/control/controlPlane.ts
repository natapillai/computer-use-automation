import type { Clock } from '../runtime/clock.js';
import type { IdProvider } from '../runtime/ids.js';
import { createControlTokens, type ControlHolder, type ControlToken } from './controlToken.js';

// The control state machine of docs/ESCALATION.md section 2. Automation and a person share one
// live session, so exactly one of them holds it at any moment. The reducer is pure, which is
// what lets every legal and illegal transition be tested without a browser, and the token
// rotates on every transition, so a holder that lost control cannot act on what it believed
// about the page, see ADR 0008.

export type ControlState = 'idle' | 'automation' | 'pending_human' | 'human' | 'resuming' | 'automation_done' | 'aborted';
export type ControlEvent = 'start' | 'pause' | 'claim' | 'release' | 'resume' | 'complete' | 'abort' | 'timeout';

// A claim that never comes ends the session rather than resuming it, because nothing has
// changed on the page and nobody is coming. The run reports escalated with unclaimed.
const TRANSITIONS: Readonly<Record<ControlState, Partial<Record<ControlEvent, ControlState>>>> = {
  idle: { start: 'automation' },
  automation: { pause: 'pending_human', complete: 'automation_done' },
  pending_human: { claim: 'human', timeout: 'aborted', abort: 'aborted' },
  human: { release: 'resuming', abort: 'aborted' },
  // A resume that finds the page somewhere unexpected escalates again rather than failing,
  // because the operator is already engaged, see docs/ESCALATION.md section 7.
  resuming: { resume: 'automation', pause: 'pending_human' },
  automation_done: {},
  aborted: {},
};

const HOLDER: Readonly<Record<ControlState, ControlHolder | null>> = {
  idle: null,
  automation: 'automation',
  pending_human: null,
  human: 'human',
  resuming: null,
  automation_done: null,
  aborted: null,
};

export class IllegalTransitionError extends Error {
  constructor(state: ControlState, event: ControlEvent) {
    super(`Control cannot ${event} from ${state}.`);
    this.name = 'IllegalTransitionError';
  }
}

export interface ControlSnapshot {
  readonly sessionId: string;
  readonly state: ControlState;
  readonly holder: ControlHolder | null;
  readonly runId: string | null;
  readonly interventionId: string | null;
  readonly updatedAt: string;
}

export interface SessionControl {
  snapshot(): ControlSnapshot;
  current(): ControlToken | null;
  assertCurrent(token: ControlToken): void;
  apply(event: ControlEvent, details?: { readonly interventionId?: string }): { readonly state: ControlState; readonly token: ControlToken | null };
}

export interface SessionControlOptions {
  readonly sessionId: string;
  readonly ids: IdProvider;
  readonly clock: Clock;
  readonly runId: string | null;
}

export function nextState(state: ControlState, event: ControlEvent): ControlState {
  const to = TRANSITIONS[state][event];
  if (to === undefined) throw new IllegalTransitionError(state, event);
  return to;
}

export function createSessionControl(options: SessionControlOptions): SessionControl {
  const tokens = createControlTokens(options.sessionId, options.ids);
  let state: ControlState = 'idle';
  let interventionId: string | null = null;
  let token: ControlToken | null = null;
  let updatedAt = options.clock.now().toISOString();

  return {
    snapshot: () => ({ sessionId: options.sessionId, state, holder: HOLDER[state], runId: options.runId, interventionId, updatedAt }),
    current: () => token,
    assertCurrent: (candidate) => {
      tokens.assertCurrent(candidate);
    },
    apply: (event, details) => {
      state = nextState(state, event);

      const holder = HOLDER[state];
      if (holder === null) {
        tokens.revoke();
        token = null;
      } else {
        token = tokens.issue(holder);
      }

      if (details?.interventionId !== undefined) interventionId = details.interventionId;
      else if (state === 'automation') interventionId = null;
      updatedAt = options.clock.now().toISOString();

      return { state, token };
    },
  };
}
