import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createSessionBroker, type SessionBroker } from '../../src/control/sessionBroker.js';
import { Capability } from '../../src/core/capability/schema.js';
import type { ReplayResult } from '../../src/core/outcome/result.js';
import { Allowlist } from '../../src/core/policy/allowlist.js';
import type { AppProfile } from '../../src/core/policy/profile.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import { ACTION_VERBS } from '../../src/core/surfaceModel/types.js';
import { replay } from '../../src/replay/executor.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { readSavingsBalanceFixture } from '../fixtures/capabilities/readSavingsBalance.js';
import { meridianProfile } from '../fixtures/profile.js';

// Gate, Skeleton 1. The hand authored fixture replayed through the broker, the guarded
// surface and the web driver against the live app, with no model anywhere.

describe('Skeleton 1, member.readSavingsBalance against MERIDIAN Core', () => {
  let server: Server;
  let browser: Browser;
  let broker: SessionBroker;
  let profile: AppProfile;

  beforeAll(async () => {
    profile = await meridianProfile();
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed: 'skeleton-1' });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    const base = `http://127.0.0.1:${address.port}`;

    browser = await chromium.launch();
    broker = createSessionBroker({
      browser,
      profile,
      allowlist: Allowlist.parse({
        version: 1,
        origins: [
          {
            pattern: base,
            description: 'MERIDIAN Core on an ephemeral port',
            allowedPaths: ['/servicing/**', '/member/**', '/auth/login'],
            deniedPaths: ['/admin/**', '/__control__/**', '/**/delete', '/**/wire/**'],
          },
        ],
        actions: { allowed: [...ACTION_VERBS], denied: ['upload', 'download', 'execScript', 'newTab', 'clipboardRead'] },
        risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
        budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
        data: { neverPersist: ['password'], redactPatterns: [] },
      }),
      baseUrl: base,
      login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: 'operator', password: 'meridian-fixture' },
      ids: createSequentialIds(),
    });
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function replayFor(memberId: string): Promise<ReplayResult> {
    const leased = await broker.lease({
      runId: 'run_000001',
      policy: { phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants: createGrantLedger() },
    });
    if (!leased.ok) throw new Error(`The lease failed. ${leased.detail}`);
    try {
      return await replay(Capability.parse(readSavingsBalanceFixture()), { memberId }, {
        surface: leased.lease.surface,
        control: leased.lease.tokens.issue('automation'),
        clock: systemClock,
        runId: 'run_000001',
        profile,
      });
    } finally {
      await leased.lease.release();
    }
  }

  it('returns 425075 minor units of USD for member 10001', async () => {
    const result = await replayFor('10001');

    expect(result).toMatchObject({ status: 'success', stepsAttempted: 4, stepsCompleted: 4, drift: [], recoveries: [], inputNames: ['memberId'] });
    if (result.status !== 'success') return;
    expect(result.outputs.savingsBalance).toEqual({ type: 'money', amountMinor: 425075, currency: 'USD', raw: '$4,250.75' });
  });

  it('returns MEMBER_NOT_FOUND for 00000 well inside the step timeout', async () => {
    const result = await replayFor('00000');

    expect(result).toMatchObject({ status: 'business_outcome', outcome: { code: 'MEMBER_NOT_FOUND' }, stepsCompleted: 2 });
    expect(Date.parse(result.endedAt) - Date.parse(result.startedAt)).toBeLessThan(15_000);
  });
});
