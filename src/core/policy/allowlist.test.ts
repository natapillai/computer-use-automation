import { describe, expect, it } from 'vitest';
import { Allowlist } from './allowlist.js';

function allowlistWith(redactPatterns: unknown[]): unknown {
  return {
    version: 1,
    origins: [{ pattern: 'http://localhost:4010', description: 'Local target', allowedPaths: ['/servicing/**'] }],
    actions: { allowed: ['click'] },
    risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
    budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
    data: { neverPersist: [], redactPatterns },
  };
}

describe('Allowlist', () => {
  it('rejects an inline (?i) flag, which JavaScript cannot compile', () => {
    const result = Allowlist.safeParse(allowlistWith([{ name: 'ssn', pattern: '(?i)ssn' }]));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]).toMatchObject({
      path: ['data', 'redactPatterns', 0, 'pattern'],
      message: 'Redaction pattern "ssn" does not compile. Put flags in the flags field.',
    });
  });

  it('accepts the same intent with flags written in the flags field', () => {
    expect(Allowlist.safeParse(allowlistWith([{ name: 'ssn', pattern: 'ssn', flags: 'gi' }])).success).toBe(true);
  });

  it('rejects an origin that carries a path, because origin matching is exact', () => {
    const input = allowlistWith([]);
    Reflect.set(input as object, 'origins', [
      { pattern: 'http://localhost:4010/servicing', description: 'Local target', allowedPaths: ['/servicing/**'] },
    ]);

    expect(Allowlist.safeParse(input).success).toBe(false);
  });
});
