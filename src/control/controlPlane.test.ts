import { describe, expect, it } from 'vitest';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { ControlLostError } from './controlToken.js';
import { createSessionControl, IllegalTransitionError, nextState, type ControlEvent, type ControlState } from './controlPlane.js';

// The control state machine of docs/ESCALATION.md section 2, as a pure reducer plus the token
// rotation around it. A human and the automation share one live session, so exactly one holder
// is valid at a time and that is enforced here rather than by convention.

const LEGAL: readonly [ControlState, ControlEvent, ControlState][] = [
  ['idle', 'start', 'automation'],
  ['automation', 'pause', 'pending_human'],
  ['automation', 'complete', 'automation_done'],
  ['pending_human', 'claim', 'human'],
  ['pending_human', 'timeout', 'aborted'],
  ['pending_human', 'abort', 'aborted'],
  ['human', 'release', 'resuming'],
  ['human', 'abort', 'aborted'],
  ['resuming', 'resume', 'automation'],
  ['resuming', 'pause', 'pending_human'],
];

function control() {
  return createSessionControl({
    sessionId: 'sess_000001',
    ids: createSequentialIds(),
    clock: createTestClock('2026-09-17T09:00:00.000Z'),
    runId: 'run_000001',
  });
}

describe('nextState', () => {
  it('allows every transition the control model declares', () => {
    expect(LEGAL.map(([from, event]) => nextState(from, event))).toEqual(LEGAL.map(([, , to]) => to));
  });

  it('throws on every transition the control model does not declare, because a wrong holder is not recoverable', () => {
    const states: ControlState[] = ['idle', 'automation', 'pending_human', 'human', 'resuming', 'automation_done', 'aborted'];
    const events: ControlEvent[] = ['start', 'pause', 'claim', 'release', 'resume', 'complete', 'abort', 'timeout'];
    const legal = new Set(LEGAL.map(([from, event]) => `${from}:${event}`));

    for (const state of states) {
      for (const event of events) {
        if (legal.has(`${state}:${event}`)) continue;
        expect(() => nextState(state, event), `${state} on ${event}`).toThrow(IllegalTransitionError);
      }
    }
  });

  it('has no path from human back to automation that skips resuming', () => {
    expect(() => nextState('human', 'resume')).toThrow(IllegalTransitionError);
    expect(() => nextState('human', 'start')).toThrow(IllegalTransitionError);
  });
});

describe('createSessionControl', () => {
  it('starts idle with no holder and no valid token', () => {
    const session = control();

    expect(session.snapshot()).toMatchObject({ sessionId: 'sess_000001', state: 'idle', holder: null, runId: 'run_000001', interventionId: null });
    expect(session.current()).toBeNull();
  });

  it('issues a token to the holder of the new state and rotates it on every transition', () => {
    const session = control();

    const automation = session.apply('start');
    expect(automation).toMatchObject({ state: 'automation', token: { holder: 'automation' } });

    const paused = session.apply('pause', { interventionId: 'int_000001' });
    expect(paused.token).toBeNull();
    expect(session.snapshot()).toMatchObject({ state: 'pending_human', holder: null, interventionId: 'int_000001' });

    const claimed = session.apply('claim');
    expect(claimed).toMatchObject({ state: 'human', token: { holder: 'human' } });
    expect(claimed.token?.value).not.toBe(automation.token?.value);
  });

  it('rejects the token a holder had before control moved, even once control comes back', () => {
    const session = control();
    const first = session.apply('start').token;
    if (first === null) throw new Error('Automation was issued no token.');

    session.apply('pause');
    session.apply('claim');
    session.apply('release');
    session.apply('resume');

    expect(session.snapshot()).toMatchObject({ state: 'automation', holder: 'automation' });
    expect(() => session.assertCurrent(first)).toThrow(ControlLostError);
  });

  it('records when the state last changed, so evidence can say who held control and when', () => {
    const session = control();

    session.apply('start');

    expect(session.snapshot().updatedAt).toBe('2026-09-17T09:00:00.000Z');
  });

  it('ends the session on a claim that never came, and refuses to act after that', () => {
    const session = control();
    session.apply('start');
    session.apply('pause', { interventionId: 'int_000001' });

    expect(session.apply('timeout')).toMatchObject({ state: 'aborted', token: null });
    expect(session.current()).toBeNull();
    expect(() => session.apply('claim')).toThrow(IllegalTransitionError);
  });
});
