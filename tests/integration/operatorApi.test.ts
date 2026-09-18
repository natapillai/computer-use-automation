import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createSessionControl, type SessionControl } from '../../src/control/controlPlane.js';
import { createSessionBroker, type Lease, type SessionBroker } from '../../src/control/sessionBroker.js';
import { Allowlist } from '../../src/core/policy/allowlist.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import { sensitiveFields, type AppProfile } from '../../src/core/policy/profile.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import { ACTION_VERBS } from '../../src/core/surfaceModel/types.js';
import { createEscalationChannel, type Handover } from '../../src/escalation/channel.js';
import { createInterventionStore, type InterventionStore } from '../../src/escalation/intervention.js';
import { createOperatorApi, type OperatorApi } from '../../src/escalation/operatorApi.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { meridianProfile } from '../fixtures/profile.js';

// The handoff over HTTP, against a real signed in session. A person claims the live session, the
// automation loses its token while they hold it, and control comes back on release. The
// screenshot the console polls is the masked one, taken from that same session.

const redactor = createRedactor({ neverPersist: [], redactPatterns: [] });

describe('the operator API against a live session', () => {
  let server: Server;
  let browser: Browser;
  let broker: SessionBroker;
  let profile: AppProfile;
  let lease: Lease;
  let base = '';

  beforeAll(async () => {
    profile = await meridianProfile();
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed: 'operator-api' });
    server = await new Promise<Server>((listening) => {
      const bound = app.listen(0, '127.0.0.1', () => listening(bound));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    const target = `http://127.0.0.1:${address.port}`;

    browser = await chromium.launch();
    broker = createSessionBroker({
      browser,
      profile,
      allowlist: Allowlist.parse({
        version: 1,
        origins: [{ pattern: target, description: 'MERIDIAN Core on an ephemeral port', allowedPaths: ['/servicing/**', '/member/**', '/auth/login'], deniedPaths: ['/admin/**', '/__control__/**'] }],
        actions: { allowed: [...ACTION_VERBS], denied: ['upload', 'download', 'execScript', 'newTab', 'clipboardRead'] },
        risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
        budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
        data: { neverPersist: ['password'], redactPatterns: [] },
      }),
      baseUrl: target,
      login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: 'operator', password: 'meridian-fixture' },
      ids: createSequentialIds(),
    });

    const leased = await broker.lease({ runId: 'run_000001', policy: { phase: 'replay', capabilityStatus: 'approved', allowUnattendedReplay: false, grants: createGrantLedger() } });
    if (!leased.ok) throw new Error(`The lease failed. ${leased.detail}`);
    lease = leased.lease;
    const token = lease.tokens.issue('automation');
    await lease.surface.perform({ action: { kind: 'navigate', path: '/servicing', framePath: [] }, framePath: [], stepId: 'entry', effect: 'read', targetKey: null }, token);
  });

  afterAll(async () => {
    await lease.release();
    await browser.close();
    await new Promise<void>((closed) => server.close(() => closed()));
  });

  async function console_(claimWindow: () => Promise<void>): Promise<{ api: OperatorApi; store: InterventionStore; control: SessionControl; handover: Promise<Handover>; announced: string[] }> {
    const store = createInterventionStore();
    const control = createSessionControl({ sessionId: lease.sessionId, ids: createSequentialIds(), clock: systemClock, runId: 'run_000001' });
    control.apply('start');

    const api = await createOperatorApi({
      store,
      control,
      // The masked screenshot of the live session, which is the only kind that exists.
      screenshot: async () => {
        const observation = await lease.surface.observe();
        return lease.surface.screenshot([...sensitiveFields(profile, observation).keys()]);
      },
      port: 0,
    });
    base = await api.listen();

    const announced: string[] = [];
    const channel = createEscalationChannel({
      store,
      control,
      clock: systemClock,
      ids: createSequentialIds(),
      redactor,
      known: [],
      consoleBaseUrl: base,
      claimTimeoutMs: 60_000,
      announce: (line) => announced.push(line),
      claimWindow,
    });

    const handover = channel.raise({
      sessionId: lease.sessionId,
      runId: 'run_000001',
      phase: 'replay',
      reason: 'UnclassifiedCondition',
      explanation: 'A dialog appeared that no rule claims.',
      suggestedAction: 'Deal with the dialog and hand control back.',
      capability: { id: 'member.readSavingsBalance', version: '1.1.0' },
      url: `${base}/servicing`,
      framePath: [],
      screenshotRef: 'captures/intervention-01.png',
      snapshotRef: 'captures/intervention-01.a11y.json',
      recentActions: [],
    });
    await Promise.resolve();
    return { api, store, control, handover, announced };
  }

  it('hands the live session to a person on claim and takes it back on release', async () => {
    const { api, control, handover, announced } = await console_(() => new Promise<void>(() => undefined));
    try {
      expect(announced[0]).toContain('/interventions/int_000001');
      expect(control.snapshot().state).toBe('pending_human');

      const open = await fetch(`${base}/interventions`).then((response) => response.json());
      expect(open).toMatchObject([{ id: 'int_000001', reason: 'UnclassifiedCondition' }]);

      const claimed = await fetch(`${base}/interventions/int_000001/claim`, { method: 'POST' }).then((response) => response.json());
      const humanToken: unknown = Reflect.get(claimed as object, 'humanToken');
      expect(typeof humanToken).toBe('string');
      expect(control.snapshot()).toMatchObject({ state: 'human', holder: 'human' });

      // The masked screenshot of the same session the person is looking at.
      const shot = await fetch(`${base}/sessions/${lease.sessionId}/screenshot`);
      const bytes = new Uint8Array(await shot.arrayBuffer());
      expect(shot.headers.get('content-type')).toContain('image/png');
      expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

      const released = await fetch(`${base}/interventions/int_000001/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-control-token': String(humanToken) },
        body: JSON.stringify({ outcome: 'resumed' }),
      });
      expect(released.status).toBe(200);
      // The run takes the session back with a token nobody else has seen, and the one the
      // person held is dead.
      const resumed = await handover;
      expect(resumed).toMatchObject({ kind: 'resumed', interventionId: 'int_000001', approved: false, token: { holder: 'automation' } });
      if (resumed.kind !== 'resumed') throw new Error('The handover did not resume.');
      expect(resumed.token.value).not.toBe(humanToken);
      expect(control.snapshot()).toMatchObject({ state: 'automation', holder: 'automation' });
    } finally {
      await api.close();
    }
  });

  it('ends the run as unclaimed when nobody comes, and refuses a claim after that', async () => {
    const { api, control, store, handover } = await console_(async () => undefined);
    try {
      expect(await handover).toEqual({ kind: 'unclaimed', interventionId: 'int_000001' });
      expect(store.status('int_000001')).toBe('expired');
      expect(control.snapshot().state).toBe('aborted');

      const late = await fetch(`${base}/interventions/int_000001/claim`, { method: 'POST' });
      expect(late.status).toBe(409);
    } finally {
      await api.close();
    }
  });
});
