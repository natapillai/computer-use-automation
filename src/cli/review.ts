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
import { readPipedStdin } from './io.js';
import { REVIEW_EXIT, runReviewCommand } from './reviewCommand.js';

// The review bin, wiring only. The behaviour and its tests live in reviewCommand.ts.
//
//   echo '{"memberId":"00000"}' | npm run review -- --capability capabilities/<id>@1.0.0.json \
//     --decision requests/<id>.<CODE>.review.json
//   npm run review -- --capability capabilities/<id>@1.1.0.json --approve <reviewer>

async function main(): Promise<number> {
  const target = parseTargetEnv(process.env);
  if (!target.ok) {
    process.stderr.write(`${target.error.message}\n`);
    return REVIEW_EXIT.usage;
  }
  const policy = await loadAllowlist('policy/allowlist.yaml');
  if (!policy.ok) {
    process.stderr.write(`${policy.message}\n`);
    return REVIEW_EXIT.usage;
  }

  const redactor = createRedactor(policy.allowlist.data);
  const { targetBaseUrl, targetUsername, targetPassword } = target.value;
  const browsers: Browser[] = [];

  try {
    return await runReviewCommand({
      argv: process.argv.slice(2),
      readStdin: readPipedStdin,
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => {
        process.stdout.write(text);
      },
      stderr: (text) => {
        process.stderr.write(text);
      },
      makeStore: (directory) => createFileCapabilityStore({ directory, redactor }),
      loadProfile: (appId) => loadProfile(`profiles/${appId}.json`),
      lease: async ({ runId, profile }) => {
        const browser = await chromium.launch();
        browsers.push(browser);
        const broker = createSessionBroker({
          browser,
          allowlist: policy.allowlist,
          profile,
          baseUrl: targetBaseUrl,
          login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: targetUsername, password: targetPassword },
          ids: systemIds,
        });
        // A probe is a replay of a draft, so it is authorized as one.
        const leased = await broker.lease({ runId, policy: { phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants: createGrantLedger() } });
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
    process.stderr.write(`Review stopped on an unexpected ${error instanceof Error ? error.name : 'error'}.\n`);
    process.exitCode = REVIEW_EXIT.failure;
  },
);
