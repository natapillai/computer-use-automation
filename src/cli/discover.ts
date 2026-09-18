import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { createSessionBroker } from '../control/sessionBroker.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { createAnthropicModelClient } from '../discovery/anthropicModelClient.js';
import { loadAllowlist } from '../runtime/allowlist.js';
import { systemClock } from '../runtime/clock.js';
import { checkLiveModelKey, parseModelEnv, parseTargetEnv } from '../runtime/env.js';
import { systemIds } from '../runtime/ids.js';
import { loadProfile } from '../runtime/profile.js';
import { DISCOVER_EXIT, runDiscoverCommand } from './discoverCommand.js';
import { readPipedStdin } from './io.js';

// The discover bin, wiring only. The behaviour and its tests live in discoverCommand.ts. It runs
// from the repository root, where requests/, policy/, profiles/ and capabilities/ are.
//
//   echo '{"memberId":"10001"}' | npm run discover -- --request requests/member.readSavingsBalance.json
//
// A live run needs ANTHROPIC_MODEL and ANTHROPIC_API_KEY. A run with --model-cassette needs neither.

async function main(): Promise<number> {
  const target = parseTargetEnv(process.env);
  if (!target.ok) {
    process.stderr.write(`${target.error.message}\n`);
    return DISCOVER_EXIT.usage;
  }
  const policy = await loadAllowlist('policy/allowlist.yaml');
  if (!policy.ok) {
    process.stderr.write(`${policy.message}\n`);
    return DISCOVER_EXIT.usage;
  }

  const redactor = createRedactor(policy.allowlist.data);
  const model = parseModelEnv(process.env);
  const { targetBaseUrl, targetUsername, targetPassword } = target.value;
  const { budgets } = policy.allowlist;
  const browsers: Browser[] = [];

  try {
    return await runDiscoverCommand({
      argv: process.argv.slice(2),
      readStdin: readPipedStdin,
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => {
        process.stdout.write(text);
      },
      stderr: (text) => {
        process.stderr.write(text);
      },
      loadProfile: (appId) => loadProfile(`profiles/${appId}.json`),
      lease: async ({ runId, profile }) => {
        const browser = await chromium.launch();
        browsers.push(browser);
        // Signed in by the broker before the model sees anything, so no credential reaches a
        // prompt, a trace or an artifact. The login form is MERIDIAN Core's.
        const broker = createSessionBroker({
          browser,
          allowlist: policy.allowlist,
          profile,
          baseUrl: targetBaseUrl,
          login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: targetUsername, password: targetPassword },
          ids: systemIds,
        });
        const grants = createGrantLedger();
        const leased = await broker.lease({ runId, policy: { phase: 'discovery', capabilityStatus: null, allowUnattendedReplay: false, grants } });
        if (!leased.ok) return { ok: false, detail: leased.detail };
        return { ok: true, lease: { surface: leased.lease.surface, control: leased.lease.tokens.issue('automation'), grants, release: () => leased.lease.release() } };
      },
      liveModel: () => {
        const key = checkLiveModelKey(process.env);
        return key.ok ? { ok: true, client: createAnthropicModelClient() } : { ok: false, message: key.error.message };
      },
      modelId: model.ok ? model.value.model : null,
      redactor,
      // The allowlist caps every run, and the loop ends as Timeout when any cap is spent.
      budgets: { maxModelCalls: budgets.maxModelCallsPerRun, maxActions: budgets.maxStepsPerRun, maxDurationMs: budgets.maxRunDurationMs },
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
    process.stderr.write(`Discovery stopped on an unexpected ${error instanceof Error ? error.name : 'error'}.\n`);
    process.exitCode = DISCOVER_EXIT.failure;
  },
);
