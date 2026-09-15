import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { createSessionBroker } from '../control/sessionBroker.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { createFileCapabilityStore } from '../evidence/capabilityStore.js';
import { loadAllowlist } from '../runtime/allowlist.js';
import { systemClock } from '../runtime/clock.js';
import { parseTargetEnv } from '../runtime/env.js';
import { systemIds } from '../runtime/ids.js';
import { loadProfile } from '../runtime/profile.js';
import { REPLAY_EXIT, runReplayCommand } from './replayCommand.js';

// The replay bin, wiring only. The behaviour and its tests live in replayCommand.ts. It runs
// from the repository root, where policy/, profiles/ and capabilities/ are.
//
//   echo '{"memberId":"10001"}' | npm run replay -- --capability capabilities/<id>@<version>.json

function readPipedStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((done, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
    });
    process.stdin.on('end', () => done(text));
    process.stdin.on('error', reject);
  });
}

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
        const leased = await broker.lease({
          runId,
          policy: { phase: 'replay', capabilityStatus: capability.lifecycle.status, allowUnattendedReplay: capability.policy.allowUnattendedReplay, grants: createGrantLedger() },
        });
        if (!leased.ok) return { ok: false, detail: leased.detail };
        return { ok: true, lease: { surface: leased.lease.surface, control: leased.lease.tokens.issue('automation'), release: () => leased.lease.release() } };
      },
      redactor,
      clock: systemClock,
      ids: systemIds,
      target: { baseUrl: targetBaseUrl },
      environment: { driver: 'web', driverVersion: '1.0.0' },
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
