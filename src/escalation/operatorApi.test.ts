import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionControl, type SessionControl } from '../control/controlPlane.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createInterventionStore, raiseIntervention, type InterventionStore } from './intervention.js';
import { createOperatorApi, type OperatorApi } from './operatorApi.js';

// The operator API of docs/ESCALATION.md section 5, driven in process. A person and the
// automation share one live session, so every state changing call has to prove it holds the
// session before it is allowed to do anything.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const redactor = createRedactor({ neverPersist: [], redactPatterns: [] });

describe('createOperatorApi', () => {
  let store: InterventionStore;
  let control: SessionControl;
  let api: OperatorApi;
  let screenshots = 0;

  beforeEach(async () => {
    screenshots = 0;
    store = createInterventionStore();
    control = createSessionControl({ sessionId: 'sess_000001', ids: createSequentialIds(), clock: createTestClock('2026-09-17T09:00:00.000Z'), runId: 'run_000001' });
    control.apply('start');
    api = await createOperatorApi({
      store,
      control,
      // Already masked by the caller, which is the only kind of screenshot that exists.
      screenshot: async () => {
        screenshots += 1;
        return PNG;
      },
    });

    raiseIntervention({
      store,
      clock: createTestClock('2026-09-17T09:00:00.000Z'),
      ids: createSequentialIds(),
      redactor,
      known: [],
      sessionId: 'sess_000001',
      runId: 'run_000001',
      phase: 'replay',
      reason: 'UnclassifiedCondition',
      explanation: 'A dialog appeared that no rule claims.',
      suggestedAction: 'Read the dialog, deal with it, and hand control back.',
      capability: { id: 'member.readSavingsBalance', version: '1.1.0' },
      atStep: { id: 'clickCellSearch', index: 1, intent: 'Click cell Search' },
      url: 'http://localhost:4010/servicing/search',
      framePath: ['content'],
      screenshotRef: 'captures/intervention-01.png',
      snapshotRef: 'captures/intervention-01.a11y.json',
      recentActions: [],
      consoleBaseUrl: 'http://127.0.0.1:4020',
      claimTimeoutMs: 300_000,
    });
    control.apply('pause', { interventionId: 'int_000001' });
  });

  afterEach(() => api.close());

  async function claim(): Promise<string> {
    const claimed = await api.inject({ method: 'POST', url: '/interventions/int_000001/claim' });
    const body: unknown = JSON.parse(claimed.body);
    const token = typeof body === 'object' && body !== null ? Reflect.get(body, 'humanToken') : null;
    if (typeof token !== 'string') throw new Error('The claim returned no human token.');
    return token;
  }

  it('serves the operator page with a canvas and the three buttons a person needs', async () => {
    const page = await api.inject({ method: 'GET', url: '/' });

    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('<canvas');
    for (const button of ['claim', 'release', 'abort']) expect(page.body).toContain(button);
  });

  it('lists what is open and serves the full context of one, and knows nothing of an id it never issued', async () => {
    const list = await api.inject({ method: 'GET', url: '/interventions' });
    const one = await api.inject({ method: 'GET', url: '/interventions/int_000001' });
    const missing = await api.inject({ method: 'GET', url: '/interventions/int_999999' });

    expect(JSON.parse(list.body)).toMatchObject([{ id: 'int_000001', reason: 'UnclassifiedCondition' }]);
    expect(JSON.parse(one.body)).toMatchObject({
      id: 'int_000001',
      capability: { id: 'member.readSavingsBalance', version: '1.1.0' },
      atStep: { id: 'clickCellSearch' },
      explanation: 'A dialog appeared that no rule claims.',
      state: { url: 'http://localhost:4010/servicing/search' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('transfers control to a person on a claim, and hands back the token the session now accepts', async () => {
    const token = await claim();

    expect(control.snapshot()).toMatchObject({ state: 'human', holder: 'human' });
    expect(control.current()?.value).toBe(token);
    expect(store.status('int_000001')).toBe('claimed');
  });

  it('refuses a second claim, because one operator holds a session', async () => {
    await claim();

    const second = await api.inject({ method: 'POST', url: '/interventions/int_000001/claim' });

    expect(second.statusCode).toBe(409);
    expect(control.snapshot().state).toBe('human');
  });

  it('hands control back on release, and settles the intervention', async () => {
    const token = await claim();

    const released = await api.inject({ method: 'POST', url: '/interventions/int_000001/release', headers: { 'x-control-token': token }, payload: { outcome: 'resumed' } });

    expect(released.statusCode).toBe(200);
    expect(control.snapshot()).toMatchObject({ state: 'resuming', holder: null });
    expect(store.status('int_000001')).toBe('released');
  });

  it('refuses a release that does not hold the session, and leaves control where it was', async () => {
    await claim();

    const forged = await api.inject({ method: 'POST', url: '/interventions/int_000001/release', headers: { 'x-control-token': 'ctl_000999' }, payload: { outcome: 'resumed' } });

    expect(forged.statusCode).toBe(403);
    expect(control.snapshot().state).toBe('human');
    expect(store.status('int_000001')).toBe('claimed');
  });

  it('ends the run on abort', async () => {
    const token = await claim();

    const aborted = await api.inject({ method: 'POST', url: '/interventions/int_000001/abort', headers: { 'x-control-token': token } });

    expect(aborted.statusCode).toBe(200);
    expect(control.snapshot().state).toBe('aborted');
    expect(store.status('int_000001')).toBe('aborted');
  });

  it('serves the masked screenshot the page polls', async () => {
    const shot = await api.inject({ method: 'GET', url: '/sessions/sess_000001/screenshot' });

    expect(shot.statusCode).toBe(200);
    expect(shot.headers['content-type']).toContain('image/png');
    expect(new Uint8Array(shot.rawPayload)).toEqual(PNG);
    expect(screenshots).toBe(1);
  });

  it('serves a screenshot of no other session', async () => {
    const other = await api.inject({ method: 'GET', url: '/sessions/sess_000002/screenshot' });

    expect(other.statusCode).toBe(404);
    expect(screenshots).toBe(0);
  });
});
