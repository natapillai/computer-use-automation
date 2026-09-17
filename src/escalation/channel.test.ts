import { describe, expect, it } from 'vitest';
import { createSessionControl } from '../control/controlPlane.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createEscalationChannel, type EscalationChannel } from './channel.js';
import { createInterventionStore, type InterventionStore } from './intervention.js';

// The run blocks here. An intervention that nobody can answer is a log line, so raising one
// stops the run in pending_human, prints where a person takes over, and waits, see ADR 0016.

const redactor = createRedactor({ neverPersist: [], redactPatterns: [] });

function channel(claimWindow: () => Promise<void>) {
  const store = createInterventionStore();
  const control = createSessionControl({ sessionId: 'sess_000001', ids: createSequentialIds(), clock: createTestClock('2026-09-17T09:00:00.000Z'), runId: 'run_000001' });
  control.apply('start');
  const announced: string[] = [];
  const escalation: EscalationChannel = createEscalationChannel({
    store,
    control,
    clock: createTestClock('2026-09-17T09:00:00.000Z'),
    ids: createSequentialIds(),
    redactor,
    known: [],
    consoleBaseUrl: 'http://127.0.0.1:4020',
    claimTimeoutMs: 300_000,
    announce: (line) => announced.push(line),
    claimWindow,
  });
  return { store, control, escalation, announced };
}

function raise(escalation: EscalationChannel) {
  return escalation.raise({
    sessionId: 'sess_000001',
    runId: 'run_000001',
    phase: 'replay',
    reason: 'UnclassifiedCondition',
    explanation: 'A dialog appeared that no rule claims.',
    suggestedAction: 'Read the dialog, deal with it, and hand control back.',
    capability: { id: 'member.readSavingsBalance', version: '1.1.0' },
    url: 'http://localhost:4010/servicing/search',
    framePath: ['content'],
    screenshotRef: 'captures/intervention-01.png',
    snapshotRef: 'captures/intervention-01.a11y.json',
    recentActions: [],
  });
}

const never = (): Promise<void> => new Promise<void>(() => undefined);

describe('createEscalationChannel', () => {
  it('blocks the run in pending_human and prints where a person takes over', async () => {
    const { control, escalation, announced, store } = channel(never);

    const handover = raise(escalation);
    await Promise.resolve();

    expect(control.snapshot()).toMatchObject({ state: 'pending_human', holder: null, interventionId: 'int_000001' });
    expect(announced).toEqual(['http://127.0.0.1:4020/interventions/int_000001']);
    expect(store.list().map((item) => item.id)).toEqual(['int_000001']);

    store.settle('int_000001', 'aborted');
    await handover;
  });

  it('returns resumed once a person hands the session back', async () => {
    const { escalation, store } = channel(never);

    const handover = raise(escalation);
    await Promise.resolve();
    store.settle('int_000001', 'claimed');
    store.settle('int_000001', 'released');

    expect(await handover).toEqual({ kind: 'resumed', interventionId: 'int_000001' });
  });

  it('returns aborted when a person ends the run', async () => {
    const { escalation, store } = channel(never);

    const handover = raise(escalation);
    await Promise.resolve();
    store.settle('int_000001', 'aborted');

    expect(await handover).toEqual({ kind: 'aborted', interventionId: 'int_000001' });
  });

  it('ends the run as unclaimed when the claim window closes and nobody came', async () => {
    const { escalation, store, control } = channel(async () => undefined);

    expect(await raise(escalation)).toEqual({ kind: 'unclaimed', interventionId: 'int_000001' });
    expect(store.status('int_000001')).toBe('expired');
    expect(control.snapshot().state).toBe('aborted');
  });

  it('never expires an intervention a person already claimed, because they are working on it', async () => {
    let close = (): void => undefined;
    const { escalation, store, control } = channel(() => new Promise<void>((resolve) => (close = resolve)));

    const handover = raise(escalation);
    await Promise.resolve();
    store.settle('int_000001', 'claimed');
    close();
    await Promise.resolve();

    expect(store.status('int_000001')).toBe('claimed');
    expect(control.snapshot().state).not.toBe('aborted');

    store.settle('int_000001', 'released');
    expect(await handover).toEqual({ kind: 'resumed', interventionId: 'int_000001' });
  });
});
