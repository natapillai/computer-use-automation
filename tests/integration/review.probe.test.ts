import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { runReviewCommand } from '../../src/cli/reviewCommand.js';
import { createSessionControl } from '../../src/control/controlPlane.js';
import { createSessionBroker, type SessionBroker } from '../../src/control/sessionBroker.js';
import { Capability } from '../../src/core/capability/schema.js';
import { Allowlist } from '../../src/core/policy/allowlist.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import type { AppProfile } from '../../src/core/policy/profile.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import { ACTION_VERBS } from '../../src/core/surfaceModel/types.js';
import { createFileCapabilityStore } from '../../src/evidence/capabilityStore.js';
import { replay } from '../../src/replay/executor.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { meridianProfile } from '../fixtures/profile.js';

// S4-T09. The negative probe against the live app, using the draft the live discovery run
// produced and the committed review. The detector must be derived from the real banner, and it
// must not fire on a member that exists.

const DECISION = 'requests/member.readSavingsBalance.MEMBER_NOT_FOUND.review.json';
const DRAFT = 'capabilities/member.readSavingsBalance@1.0.0.json';

describe('negative probe review against MERIDIAN Core', () => {
  let server: Server;
  let browser: Browser;
  let broker: SessionBroker;
  let profile: AppProfile;
  let root: string;
  let draftPath = '';

  beforeAll(async () => {
    profile = await meridianProfile();
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed: 'review-probe' });
    server = await new Promise<Server>((listening) => {
      const bound = app.listen(0, '127.0.0.1', () => listening(bound));
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
        origins: [{ pattern: base, description: 'MERIDIAN Core on an ephemeral port', allowedPaths: ['/servicing/**', '/member/**', '/auth/login'], deniedPaths: ['/admin/**', '/__control__/**'] }],
        actions: { allowed: [...ACTION_VERBS], denied: ['upload', 'download', 'execScript', 'newTab', 'clipboardRead'] },
        risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
        budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
        data: { neverPersist: ['password'], redactPatterns: [] },
      }),
      baseUrl: base,
      login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: 'operator', password: 'meridian-fixture' },
      ids: createSequentialIds(),
    });

    root = await mkdtemp(join(tmpdir(), 'review-probe-'));
    const store = createFileCapabilityStore({ directory: join(root, 'capabilities'), redactor: createRedactor({ neverPersist: [], redactPatterns: [] }) });
    const written = await store.write(JSON.parse(await readFile(DRAFT, 'utf8')), { inputValues: {} });
    if (!written.ok) throw new Error(`The discovered draft was not copied. ${written.detail}`);
    draftPath = written.path;
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((closed) => server.close(() => closed()));
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  async function lease(runId: string) {
    const grants = createGrantLedger();
    const leased = await broker.lease({ runId, policy: { phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants } });
    if (!leased.ok) throw new Error(`The lease failed. ${leased.detail}`);
    const session = createSessionControl({ sessionId: leased.lease.sessionId, ids: createSequentialIds(), clock: systemClock, runId, tokens: leased.lease.tokens });
    const control = session.apply('start').token;
    if (control === null) throw new Error('A started session was issued no token.');
    return { surface: leased.lease.surface, control, session, grants, human: leased.lease.human, release: () => leased.lease.release() };
  }

  it(
    'derives MEMBER_NOT_FOUND from the real banner, and the detector does not fire for a member that exists',
    async () => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runReviewCommand({
        argv: ['--capability', draftPath, '--decision', DECISION, '--evidence', join(root, 'evidence')],
        readStdin: async () => '{"memberId":"00000"}',
        readText: (path) => readFile(path, 'utf8'),
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        makeStore: (directory) => createFileCapabilityStore({ directory, redactor: createRedactor({ neverPersist: [], redactPatterns: [] }) }),
        loadProfile: async () => ({ ok: true, profile }),
        lease: async ({ runId }) => ({ ok: true, lease: await lease(runId) }),
        redactor: createRedactor({ neverPersist: [], redactPatterns: [] }),
        clock: systemClock,
        ids: createSequentialIds(),
        target: { baseUrl: 'http://127.0.0.1' },
        environment: { driver: 'web', driverVersion: '1.0.0' },
        console: { port: 0, claimTimeoutMs: 60_000 },
      });

      expect(code, err.join('')).toBe(0);
      expect(JSON.parse(out.join(''))).toMatchObject({
        status: 'declared',
        code: 'MEMBER_NOT_FOUND',
        probe: { status: 'failure', class: 'CheckpointFailed' },
        verification: { status: 'business_outcome', code: 'MEMBER_NOT_FOUND' },
      });

      const reviewed = Capability.parse(JSON.parse(await readFile(join(root, 'capabilities', 'member.readSavingsBalance@1.1.0.json'), 'utf8')));
      const [outcome] = reviewed.outcomes;
      expect(outcome).toMatchObject({ code: 'MEMBER_NOT_FOUND', provenance: 'manual', detect: { kind: 'elementPresent' } });
      expect(JSON.stringify(outcome?.detect)).toContain('No records found.');

      const held = await lease('run_happy');
      try {
        const success = await replay(reviewed, { memberId: '10001' }, { surface: held.surface, control: held.control, clock: systemClock, runId: 'run_happy', profile });
        expect(success).toMatchObject({ status: 'success', outputs: { savingsBalance: { amountMinor: 425075, currency: 'USD' } } });
      } finally {
        await held.release();
      }
    },
    90_000,
  );
});
