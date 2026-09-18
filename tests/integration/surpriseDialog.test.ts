import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createSessionBroker, type Lease, type SessionBroker } from '../../src/control/sessionBroker.js';
import { Capability } from '../../src/core/capability/schema.js';
import { Allowlist } from '../../src/core/policy/allowlist.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import { sensitiveFields, type AppProfile } from '../../src/core/policy/profile.js';
import { ACTION_VERBS } from '../../src/core/surfaceModel/types.js';
import type { EscalationChannel, RaiseInput } from '../../src/escalation/channel.js';
import { replay } from '../../src/replay/executor.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { meridianProfile } from '../fixtures/profile.js';

// S5-T05. A modal nobody declared appears mid run. The run must stop on it and hand the session
// to a person. It must not click it to find out what it says, which is the failure mode that
// makes an unattended banking automation dangerous.

const DRAFT = 'capabilities/member.readSavingsBalance@1.0.0.json';

describe('a dialog the capability never declared', () => {
  let server: Server;
  let browser: Browser;
  let broker: SessionBroker;
  let profile: AppProfile;
  let target = '';

  beforeAll(async () => {
    profile = await meridianProfile();
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: true, idSeed: 'surprise' });
    server = await new Promise<Server>((listening) => {
      const bound = app.listen(0, '127.0.0.1', () => listening(bound));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    target = `http://127.0.0.1:${address.port}`;

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
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((closed) => server.close(() => closed()));
  });

  it('stops for a person, captures the screen, and never clicks the dialog away', async () => {
    // Armed on the search response, where this draft declares no outcome that could claim it.
    const armed = await fetch(`${target}/__control__/fault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault: 'surpriseDialog', path: '/servicing/search', method: 'POST', count: 1 }),
    });
    expect(armed.status).toBe(200);

    const leased = await broker.lease({ runId: 'run_000001', policy: { phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants: createGrantLedger() } });
    if (!leased.ok) throw new Error(`The lease failed. ${leased.detail}`);
    const lease: Lease = leased.lease;

    const raised: RaiseInput[] = [];
    const escalation: EscalationChannel = {
      raise: async (input) => {
        raised.push(input);
        return { kind: 'aborted', interventionId: 'int_000001' };
      },
    };

    const shots: number[] = [];
    try {
      const capability = Capability.parse(JSON.parse(await readFile(DRAFT, 'utf8')));
      const result = await replay(capability, { memberId: '00000' }, {
        surface: lease.surface,
        control: lease.tokens.issue('automation'),
        clock: systemClock,
        runId: 'run_000001',
        profile,
        escalation,
        grants: createGrantLedger(),
        capture: async () => {
          const observation = await lease.surface.observe();
          const bytes = await lease.surface.screenshot([...sensitiveFields(profile, observation).keys()]);
          shots.push(bytes.length);
          return { screenshotRef: 'captures/intervention-01.png', snapshotRef: 'captures/intervention-01.a11y.json' };
        },
      });

      expect(raised.map((input) => input.reason)).toEqual(['UnclassifiedCondition']);
      expect(result).toMatchObject({ status: 'escalated', intervention: { reason: 'UnclassifiedCondition', disposition: 'aborted' } });

      // The person gets a picture of what stopped the run.
      expect(shots).toHaveLength(1);
      expect(shots[0]).toBeGreaterThan(0);

      // Nothing dismissed the modal, which is the point. It is still on the screen.
      const after = await lease.surface.observe();
      expect(after.dialogOpen).toBe(true);
    } finally {
      await lease.release();
    }
  }, 60_000);
});
