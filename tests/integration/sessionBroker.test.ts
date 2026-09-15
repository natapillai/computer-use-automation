import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { ControlLostError } from '../../src/control/controlToken.js';
import { createSessionBroker, type FormLogin, type Lease, type LeaseRequest, type LeaseResult } from '../../src/control/sessionBroker.js';
import { Allowlist } from '../../src/core/policy/allowlist.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import type { AppProfile } from '../../src/core/policy/profile.js';
import { meridianProfile } from '../fixtures/profile.js';
import { ACTION_VERBS } from '../../src/core/surfaceModel/types.js';
import { createSequentialIds } from '../../src/runtime/ids.js';

const PASSWORD = 'meridian-fixture';

const request: LeaseRequest = {
  runId: 'run_000001',
  policy: { phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants: createGrantLedger() },
};

function leased(result: LeaseResult): Lease {
  if (!result.ok) throw new Error(`The lease failed. ${result.detail}`);
  return result.lease;
}

describe('SessionBroker against MERIDIAN Core', { timeout: 30_000 }, () => {
  let server: Server;
  let port: number;
  let base: string;
  let browser: Browser;
  let profile: AppProfile;

  function allowlistFor(origin: string): Allowlist {
    return Allowlist.parse({
      version: 1,
      origins: [
        {
          pattern: origin,
          description: 'MERIDIAN Core on an ephemeral port',
          allowedPaths: ['/servicing/**', '/member/**', '/auth/login'],
          deniedPaths: ['/admin/**', '/__control__/**', '/**/delete', '/**/wire/**'],
        },
      ],
      actions: { allowed: [...ACTION_VERBS], denied: ['upload', 'download', 'execScript', 'newTab', 'clipboardRead'] },
      risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
      budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
      data: { neverPersist: ['password'], redactPatterns: [] },
    });
  }

  function brokerWith(login: Partial<FormLogin> = {}) {
    return createSessionBroker({
      browser,
      profile,
      allowlist: allowlistFor(base),
      baseUrl: base,
      login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: 'operator', password: PASSWORD, ...login },
      ids: createSequentialIds(),
    });
  }

  function pageOf(lease: Lease): Page {
    const page = browser.contexts().flatMap((context) => context.pages()).at(-1);
    if (page === undefined) throw new Error(`Lease ${lease.sessionId} has no page.`);
    return page;
  }

  beforeAll(async () => {
    const app = createTargetApp({ username: 'operator', password: PASSWORD, testMode: true, idSeed: 'broker' });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    port = address.port;
    base = `http://127.0.0.1:${port}`;
    browser = await chromium.launch();
    profile = await meridianProfile();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('leases a session that is signed in before anything acts on it', async () => {
    const lease = leased(await brokerWith().lease(request));
    try {
      const token = lease.tokens.issue('automation');
      const outcome = await lease.surface.perform(
        { action: { kind: 'navigate', path: '/servicing', framePath: [] }, framePath: [], stepId: 'entry', effect: 'read', targetKey: null },
        token,
      );

      expect(outcome).toEqual({ kind: 'performed', result: { ok: true } });
      expect((await lease.surface.observe()).frames).toContainEqual({ framePath: ['content'], url: `${base}/servicing/search`, lastStatus: 200 });
    } finally {
      await lease.release();
    }
  });

  it('refuses a denied path and a foreign origin at the network layer, for a request policy never saw', async () => {
    const lease = leased(await brokerWith().lease(request));
    try {
      // A blocked navigation is followed by Chromium loading its own error page, which
      // would interrupt the next navigation on the same page. Each visit gets a fresh page
      // in the leased context, and every page in the context shares the guard.
      const context = pageOf(lease).context();
      const visit = async (url: string) => (await context.newPage()).goto(url);
      expect((await fetch(`${base}/__control__/state`)).status).toBe(200);

      await expect(visit(`${base}/__control__/state`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
      await expect(visit(`http://localhost:${port}/servicing`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
      expect((await visit(`${base}/servicing`))?.status()).toBe(200);
      expect(lease.refusedRequests()).toEqual(['deniedPath', 'origin']);
    } finally {
      await lease.release();
    }
  });

  it('reports a refused login as SurfaceUnavailable and never repeats the credentials', async () => {
    const result = await brokerWith({ password: 'not-the-password' }).lease(request);

    expect(result).toMatchObject({ ok: false, failure: 'SurfaceUnavailable' });
    expect(JSON.stringify(result)).not.toContain('not-the-password');
    expect(JSON.stringify(result)).not.toContain('operator');
  });

  it('refuses to send credentials to a login path outside the allowlist', async () => {
    expect(await brokerWith({ path: '/admin/login' }).lease(request)).toMatchObject({ ok: false, failure: 'SurfaceUnavailable' });
  });

  it('gives each lease its own session and its own control tokens', async () => {
    const broker = brokerWith();
    const first = leased(await broker.lease(request));
    const second = leased(await broker.lease(request));
    try {
      expect(first.sessionId).not.toBe(second.sessionId);
      const firstToken = first.tokens.issue('automation');
      second.tokens.issue('automation');

      await expect(
        second.surface.perform(
          { action: { kind: 'navigate', path: '/servicing', framePath: [] }, framePath: [], stepId: 'entry', effect: 'read', targetKey: null },
          firstToken,
        ),
      ).rejects.toBeInstanceOf(ControlLostError);
    } finally {
      await first.release();
      await second.release();
    }
  });
});
