import type { IdProvider } from '../runtime/ids.js';

// Fencing tokens for one live session, see ADR 0008. Exactly one token is current. Every
// issue rotates it, so a holder that lost control, even briefly, cannot act on
// assumptions about a page that someone else may have changed.

export type ControlHolder = 'automation' | 'human';

export interface ControlToken {
  readonly sessionId: string;
  readonly holder: ControlHolder;
  readonly value: string;
}

export class ControlLostError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Control of session ${sessionId} has moved to another holder or ended. Re observe before acting.`);
    this.name = 'ControlLostError';
    this.sessionId = sessionId;
  }
}

export interface ControlGate {
  assertCurrent(token: ControlToken): void;
}

export interface SessionControlTokens extends ControlGate {
  readonly sessionId: string;
  issue(holder: ControlHolder): ControlToken;
  revoke(): void;
  isCurrent(token: ControlToken): boolean;
}

export function createControlTokens(sessionId: string, ids: IdProvider): SessionControlTokens {
  let current: ControlToken | null = null;

  const isCurrent = (token: ControlToken): boolean =>
    current !== null && token.sessionId === current.sessionId && token.holder === current.holder && token.value === current.value;

  return {
    sessionId,
    issue: (holder) => {
      const token: ControlToken = { sessionId, holder, value: ids.next('ctl') };
      current = token;
      return token;
    },
    revoke: () => {
      current = null;
    },
    isCurrent,
    // The message names the session and never the token value, which is a capability.
    assertCurrent: (token) => {
      if (!isCurrent(token)) throw new ControlLostError(sessionId);
    },
  };
}
