import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createSessionBroker, type Lease } from '../../src/control/sessionBroker.js';
import type { ControlToken } from '../../src/control/controlToken.js';
import { Allowlist } from '../../src/core/policy/allowlist.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import { walkNodes } from '../../src/core/surfaceModel/tree.js';
import { ACTION_VERBS, type Observation } from '../../src/core/surfaceModel/types.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { meridianProfile } from '../fixtures/profile.js';

// A person clicking on the console is clicking on a picture. What arrives is a point in page
// space, which is why the forwarding path hit tests before it dispatches. This runs that path
// against the real frameset, where the content frame is offset from the page origin.

function point(observation: Observation, role: string, name: string): { x: number; y: number } {
  const nodes = [...walkNodes(observation.root)];
  const target = nodes.find((node) => node.framePath.join('/') === 'content' && node.role === role && node.name.replace(/\s+/g, ' ').trim() === name);
  if (target === undefined) throw new Error(`The content frame has no ${role} named ${name}.`);

  // The console works in page space, so the frame origin is added to the frame relative box.
  const frame = nodes.find((node) => node.role === 'iframe' && node.framePath.length === 0 && [...walkNodes(node)].some((child) => child.framePath.join('/') === 'content'));
  if (frame === undefined) throw new Error('No iframe in the page holds the content frame.');

  return { x: frame.box.x + target.box.x + target.box.width / 2, y: frame.box.y + target.box.y + target.box.height / 2 };
}

describe('forwarding a person input into the live session', () => {
  let server: Server;
  let browser: Browser;
  let lease: Lease;
  let token: ControlToken;

  beforeAll(async () => {
    const profile = await meridianProfile();
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed: 'human-input' });
    server = await new Promise<Server>((listening) => {
      const bound = app.listen(0, '127.0.0.1', () => listening(bound));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    const target = `http://127.0.0.1:${address.port}`;

    browser = await chromium.launch();
    const broker = createSessionBroker({
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
    token = lease.tokens.issue('automation');
    await lease.surface.perform({ action: { kind: 'navigate', path: '/servicing', framePath: [] }, framePath: [], stepId: 'entry', effect: 'read', targetKey: null }, token);
  });

  afterAll(async () => {
    await lease.release();
    await browser.close();
    await new Promise<void>((closed) => server.close(() => closed()));
  });

  it('lands the click on the element under the point, records what was touched, and changes the same session', async () => {
    const before = await lease.surface.observe();

    const record = await lease.human.click(point(before, 'cell', 'Search'));

    expect(record).toMatchObject({ kind: 'click', target: { describedAs: 'cell Search' } });
    // The record says what was touched, where and when. It never says what was typed.
    expect(JSON.stringify(record)).not.toContain('"value"');

    // The bundle it derived is a real locator, so it resolves on the page like any other.
    await lease.surface.waitForChange(3_000);
    const after = await lease.surface.observe();
    if (record.target === null) throw new Error('The hit test named nothing.');
    const resolution = await lease.surface.resolve(record.target.bundle, token);
    expect(resolution.ok).toBe(true);

    // The click reached the content frame of the session the automation was using, and the app
    // answered the submission it caused.
    const answered = [...walkNodes(after.root)].some((node) => node.name.includes('Enter a member ID or surname'));
    expect(answered).toBe(true);
  });

  it('records a keystroke with no element and no value', async () => {
    const record = await lease.human.press('Tab');

    expect(record).toMatchObject({ kind: 'press', key: 'Tab', target: null });
    expect(JSON.stringify(record)).not.toContain('"value"');
  });
});
