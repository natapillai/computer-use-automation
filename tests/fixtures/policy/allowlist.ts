import { Allowlist } from '../../../src/core/policy/allowlist.js';
import { ACTION_VERBS } from '../../../src/core/surfaceModel/types.js';

// The committed allowlist rules for an app running on an ephemeral port.
export function allowlistFor(origin: string): Allowlist {
  return Allowlist.parse({
    version: 1,
    origins: [
      {
        pattern: origin,
        description: 'MERIDIAN Core on an ephemeral port',
        allowedPaths: ['/servicing/**', '/member/**', '/auth/login', '/favicon.ico'],
        deniedPaths: ['/admin/**', '/__control__/**', '/**/delete', '/**/wire/**'],
      },
    ],
    actions: { allowed: [...ACTION_VERBS], denied: ['upload', 'download', 'execScript', 'newTab', 'clipboardRead'] },
    risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
    budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
    data: { neverPersist: ['password'], redactPatterns: [] },
  });
}
