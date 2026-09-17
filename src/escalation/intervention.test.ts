import { describe, expect, it } from 'vitest';
import { createRedactor } from '../core/redaction/redactor.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createInterventionStore, raiseIntervention, type RaiseContext } from './intervention.js';

// The intervention request of docs/ESCALATION.md section 4. The brief asks for enough context to
// act on, which capability or goal, the step, the state or a screenshot, and why it stopped.
// Every one of those is required here, and all of it is redacted, because it is sent to a
// browser over HTTP.

const redactor = createRedactor({ neverPersist: [], redactPatterns: [{ name: 'cardNumber', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', flags: 'g', validator: 'luhn' }] });

function context(overrides: Partial<RaiseContext> = {}): RaiseContext {
  return {
    store: createInterventionStore(),
    clock: createTestClock('2026-09-17T09:00:00.000Z'),
    ids: createSequentialIds(),
    redactor,
    known: [{ value: '10001', replacement: '{{inputs.memberId}}' }],
    sessionId: 'sess_000001',
    runId: 'run_000001',
    phase: 'replay',
    reason: 'UnclassifiedCondition',
    explanation: 'A dialog appeared on the member 10001 detail screen and no rule in the capability or the app profile claims it.',
    suggestedAction: 'Read the dialog, deal with it, and hand control back.',
    capability: { id: 'member.readSavingsBalance', version: '1.1.0' },
    atStep: { id: 'clickLinkMemberId', index: 2, intent: 'Click link the memberId input' },
    url: 'http://localhost:4010/member/10001',
    framePath: ['content'],
    screenshotRef: 'captures/intervention-01.png',
    snapshotRef: 'captures/intervention-01.a11y.json',
    recentActions: [{ at: '2026-09-17T08:59:59.000Z', kind: 'click', describedAs: 'link 10001', ok: true }],
    consoleBaseUrl: 'http://127.0.0.1:4020',
    claimTimeoutMs: 300_000,
    ...overrides,
  };
}

describe('raiseIntervention', () => {
  it('carries the capability, the step, the state and the reason a person needs to act', () => {
    const raised = raiseIntervention(context());

    expect(raised).toMatchObject({
      id: 'int_000001',
      createdAt: '2026-09-17T09:00:00.000Z',
      sessionId: 'sess_000001',
      runId: 'run_000001',
      phase: 'replay',
      capability: { id: 'member.readSavingsBalance', version: '1.1.0' },
      reason: 'UnclassifiedCondition',
      atStep: { id: 'clickLinkMemberId', index: 2 },
      state: { framePath: ['content'], screenshotRef: 'captures/intervention-01.png', snapshotRef: 'captures/intervention-01.a11y.json' },
      consoleUrl: 'http://127.0.0.1:4020/interventions/int_000001',
    });
    expect(raised.suggestedAction).toContain('hand control back');
  });

  it('redacts the url, the explanation and the recorded actions, because the payload reaches a browser', () => {
    const raised = raiseIntervention(context());

    const text = JSON.stringify(raised);
    expect(text).not.toContain('10001');
    expect(raised.state.url).toBe('http://localhost:4010/member/{{inputs.memberId}}');
    expect(raised.explanation).toContain('{{inputs.memberId}}');
    expect(raised.state.recentActions[0]?.describedAs).toBe('link {{inputs.memberId}}');
  });

  it('hides a value nobody declared, such as a card number in a dialog message', () => {
    const raised = raiseIntervention(context({ explanation: 'A dialog says the card 4111 1111 1111 1111 is blocked.' }));

    expect(raised.explanation).not.toContain('4111');
  });

  it('expires when the claim timeout runs out, so a session is not held open forever', () => {
    const raised = raiseIntervention(context({ claimTimeoutMs: 300_000 }));

    expect(raised.expiresAt).toBe('2026-09-17T09:05:00.000Z');
  });

  it('describes a discovery run by its goal, which carries no value either', () => {
    const raised = raiseIntervention(context({ phase: 'discovery', capability: undefined, goal: 'find the balance of {{inputs.memberId}}', reason: 'NoProgress' }));

    expect(raised).toMatchObject({ phase: 'discovery', goal: 'find the balance of {{inputs.memberId}}', reason: 'NoProgress' });
    expect(raised.capability).toBeUndefined();
  });
});

describe('createInterventionStore', () => {
  it('lists what is open, and stops listing one that was claimed, released or aborted', () => {
    const store = createInterventionStore();
    const raised = raiseIntervention(context({ store }));

    expect(store.list().map((item) => item.id)).toEqual(['int_000001']);
    expect(store.get('int_000001')).toMatchObject({ id: 'int_000001' });
    expect(store.status('int_000001')).toBe('open');

    store.settle('int_000001', 'claimed');
    expect(store.status('int_000001')).toBe('claimed');
    expect(store.list()).toEqual([]);
    expect(store.get(raised.id)).not.toBeNull();
  });

  it('tells a listener when an intervention settles, which is how a blocked run learns it can go on', () => {
    const store = createInterventionStore();
    raiseIntervention(context({ store }));
    const seen: [string, string][] = [];
    const stop = store.subscribe((id, state) => seen.push([id, state]));

    store.settle('int_000001', 'claimed');
    stop();
    store.settle('int_000001', 'released');

    expect(seen).toEqual([['int_000001', 'claimed']]);
  });

  it('knows nothing about an id it never issued', () => {
    const store = createInterventionStore();

    expect(store.get('int_999999')).toBeNull();
    expect(store.status('int_999999')).toBeNull();
    expect(() => store.settle('int_999999', 'claimed')).toThrow(TypeError);
  });
});
