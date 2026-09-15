import { describe, expect, it } from 'vitest';
import { runFakeDiscovery } from '../../tests/fixtures/discovery/fakeRun.js';
import { buildTrace } from './trace.js';

describe('buildTrace', () => {
  it('keeps the observation hashes, decisions and authorization verdicts of the run', async () => {
    const { trace } = await runFakeDiscovery();

    const hashes = trace.events.flatMap((event) => (event.t === 'observation' ? [event.observationHash] : []));
    expect(hashes.length).toBeGreaterThan(0);
    expect(hashes.every((hash) => /^[0-9a-f]{16}$/.test(hash))).toBe(true);
    expect(trace.events.flatMap((event) => (event.t === 'decision' ? [event.tool] : []))).toEqual(['fill', 'click', 'click', 'extract', 'done']);
    expect(trace.events.flatMap((event) => (event.t === 'authorization' ? [event.verdict] : []))).toEqual(['allow', 'allow', 'allow', 'allow']);
  });

  it('keeps each acted element neighbourhood with member data hidden and the supplied value as its template', async () => {
    const { trace } = await runFakeDiscovery();
    const elementActions = trace.actions.filter((action) => action.tool !== 'navigate');

    expect(elementActions.every((action) => action.neighbourhood !== undefined)).toBe(true);
    const text = JSON.stringify(elementActions.map((action) => action.neighbourhood));
    for (const literal of ['10001', 'Test Member One', '4111 1111 1111 1111', '4,250.75']) expect(text).not.toContain(literal);
    expect(text).toContain('{{inputs.memberId}}');
  });

  it('refuses to build a trace without the observation the run ended on', async () => {
    const { result, recorder, events } = await runFakeDiscovery();

    expect(() => buildTrace({ runId: 'run_000001', goal: 'Read the balance', inputNames: ['memberId'], result: { ...result, finalObservation: null }, recorder, events })).toThrow(TypeError);
  });
});
