import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { createSessionControl } from '../control/controlPlane.js';
import { createSessionBroker } from '../control/sessionBroker.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { createFileCapabilityStore } from '../evidence/capabilityStore.js';
import { loadAllowlist } from '../runtime/allowlist.js';
import { systemClock } from '../runtime/clock.js';
import { parseTargetEnv } from '../runtime/env.js';
import { systemIds } from '../runtime/ids.js';
import { loadProfile } from '../runtime/profile.js';
import { readPipedStdin } from './io.js';
import { REPLAY_EXIT, runReplayCommand } from './replayCommand.js';

// The replay bin, wiring only. The behaviour and its tests live in replayCommand.ts. It runs
// from the repository root, where policy/, profiles/ and capabilities/ are.
//
//   echo '{"memberId":"10001"}' | npm run replay -- --capability capabilities/<id>@<version>.json
//
// While it runs it hosts the operator console on :4020. A run that stops for a person prints
// the URL of the intervention on stderr and waits there, for as long as
// INTERVENTION_CLAIM_TIMEOUT_MS allows.

const OPERATOR_PORT = 4020;

async function main(): Promise<number> {
  const target = parseTargetEnv(process.env);
  if (!target.ok) {
    process.stderr.write(`${target.error.message}\n`);
    return REPLAY_EXIT.usage;
  }
  const policy = await loadAllowlist('policy/allowlist.yaml');
  if (!policy.ok) {
    process.stderr.write(`${policy.message}\n`);
    return REPLAY_EXIT.usage;
  }

  const redactor = createRedactor(policy.allowlist.data);
  const { targetBaseUrl, targetUsername, targetPassword } = target.value;
  const browsers: Browser[] = [];

  try {
    return await runReplayCommand({
      argv: process.argv.slice(2),
      readStdin: readPipedStdin,
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => {
        process.stdout.write(text);
      },
      stderr: (text) => {
        process.stderr.write(text);
      },
      store: createFileCapabilityStore({ directory: 'capabilities', redactor }),
      loadProfile: (appId) => loadProfile(`profiles/${appId}.json`),
      lease: async ({ runId, capability, profile }) => {
        const browser = await chromium.launch();
        browsers.push(browser);
        // The session is signed in by the broker before any step runs, so the capability never
        // holds a credential. The login form is MERIDIAN Core's.
        const broker = createSessionBroker({
          browser,
          allowlist: policy.allowlist,
          profile,
          baseUrl: targetBaseUrl,
          login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: targetUsername, password: targetPassword },
          ids: systemIds,
        });
        const grants = createGrantLedger();
        const leased = await broker.lease({
          runId,
          policy: { phase: 'replay', capabilityStatus: capability.lifecycle.status, allowUnattendedReplay: capability.policy.allowUnattendedReplay, grants },
        });
        if (!leased.ok) return { ok: false, detail: leased.detail };
        // The control plane rotates the tokens the live session already gates on, so a person
        // who claims it can act and the run gets a token back that the driver accepts.
        const session = createSessionControl({ sessionId: leased.lease.sessionId, ids: systemIds, clock: systemClock, runId, tokens: leased.lease.tokens });
        const control = session.apply('start').token;
        if (control === null) return { ok: false, detail: 'The session issued no token to start with.' };
        return { ok: true, lease: { surface: leased.lease.surface, control, session, grants, human: leased.lease.human, release: () => leased.lease.release() } };
      },
      redactor,
      clock: systemClock,
      ids: systemIds,
      target: { baseUrl: targetBaseUrl },
      environment: { driver: 'web', driverVersion: '1.0.0' },
      // The operator console of docs/CLAUDE.md section 5, hosted for as long as the run lives.
      console: { port: OPERATOR_PORT, claimTimeoutMs: target.value.interventionClaimTimeoutMs },
    });
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()));
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // The error name only. A message from a failed launch or request can carry a url or a value.
    process.stderr.write(`Replay stopped on an unexpected ${error instanceof Error ? error.name : 'error'}.\n`);
    process.exitCode = REPLAY_EXIT.failure;
  },
);
