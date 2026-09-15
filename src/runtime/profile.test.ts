import { describe, expect, it } from 'vitest';
import { loadProfile } from './profile.js';

describe('loadProfile', () => {
  it('loads and validates the committed MERIDIAN Core profile', async () => {
    const result = await loadProfile('profiles/meridian-core.json');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.appId).toBe('meridian-core');
    expect(result.profile.routes).toContainEqual(expect.objectContaining({ method: 'POST', path: '/servicing/search', effect: 'read', idempotent: false }));
  });

  it('reports a missing or invalid profile as a typed failure rather than throwing', async () => {
    expect(await loadProfile('profiles/does-not-exist.json')).toMatchObject({ ok: false, failure: 'ProfileInvalid' });
    expect(await loadProfile('policy/allowlist.yaml')).toMatchObject({ ok: false, failure: 'ProfileInvalid' });
  });
});
