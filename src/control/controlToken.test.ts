import { describe, expect, it } from 'vitest';
import { createSequentialIds } from '../runtime/ids.js';
import { ControlLostError, createControlTokens, type ControlToken } from './controlToken.js';

function rejected(assert: () => void): unknown {
  try {
    assert();
  } catch (error) {
    return error;
  }
  return null;
}

describe('createControlTokens', () => {
  it('accepts the token it issued most recently', () => {
    const tokens = createControlTokens('sess_000001', createSequentialIds());
    const token = tokens.issue('automation');

    expect(tokens.isCurrent(token)).toBe(true);
    expect(() => tokens.assertCurrent(token)).not.toThrow();
  });

  it('rotates on every issue, so an earlier token is stale even when the holder is the same', () => {
    const tokens = createControlTokens('sess_000001', createSequentialIds());
    const first = tokens.issue('automation');
    const human = tokens.issue('human');
    const second = tokens.issue('automation');

    expect(new Set([first.value, human.value, second.value]).size).toBe(3);
    expect(rejected(() => tokens.assertCurrent(first))).toBeInstanceOf(ControlLostError);
    expect(rejected(() => tokens.assertCurrent(human))).toBeInstanceOf(ControlLostError);
    expect(tokens.isCurrent(second)).toBe(true);
  });

  it('rejects every token before one is issued and after control is revoked', () => {
    const tokens = createControlTokens('sess_000001', createSequentialIds());
    const unissued: ControlToken = { sessionId: 'sess_000001', holder: 'automation', value: '' };

    expect(rejected(() => tokens.assertCurrent(unissued))).toBeInstanceOf(ControlLostError);

    const token = tokens.issue('automation');
    tokens.revoke();
    expect(rejected(() => tokens.assertCurrent(token))).toBeInstanceOf(ControlLostError);
  });

  it('rejects a token issued for another session even when its value collides', () => {
    const sessionA = createControlTokens('sess_000001', createSequentialIds());
    const sessionB = createControlTokens('sess_000002', createSequentialIds());
    const tokenA = sessionA.issue('automation');
    const tokenB = sessionB.issue('automation');

    expect(tokenB.value).toBe(tokenA.value);
    expect(rejected(() => sessionA.assertCurrent(tokenB))).toBeInstanceOf(ControlLostError);
  });

  it('names the session in the error and never the token value', () => {
    const tokens = createControlTokens('sess_000001', createSequentialIds());
    const stale = tokens.issue('automation');
    tokens.issue('human');

    const error = rejected(() => tokens.assertCurrent(stale));

    expect(error).toBeInstanceOf(ControlLostError);
    if (!(error instanceof ControlLostError)) return;
    expect(error.sessionId).toBe('sess_000001');
    expect(error.message).toContain('sess_000001');
    expect(error.message).not.toContain(stale.value);
  });
});
