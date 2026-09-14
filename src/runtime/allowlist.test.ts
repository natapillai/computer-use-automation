import { describe, expect, it } from 'vitest';
import { loadAllowlist } from './allowlist.js';

describe('loadAllowlist', () => {
  it('loads and validates the committed allowlist', async () => {
    const result = await loadAllowlist('policy/allowlist.yaml');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.allowlist.origins.map((origin) => origin.pattern)).toEqual(['http://localhost:4010']);
    expect(result.allowlist.origins[0]?.deniedPaths).toContain('/__control__/**');
    expect(result.allowlist.data.redactPatterns.map((pattern) => pattern.name)).toContain('cardNumber');
  });

  it('reports an allowlist that fails validation as a typed failure naming the field', async () => {
    const result = await loadAllowlist('tests/fixtures/policy/allowlist-with-path.yaml');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe('AllowlistInvalid');
    expect(result.message).toContain('origins.0.pattern');
  });

  it('reports a missing file as a typed failure rather than throwing', async () => {
    const result = await loadAllowlist('policy/does-not-exist.yaml');

    expect(result).toMatchObject({ ok: false, failure: 'AllowlistInvalid' });
  });
});
