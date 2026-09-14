import { describe, expect, it } from 'vitest';
import { LocatorBundle } from './schema.js';

const textStrategy = { kind: 'text', text: 'Search', exact: true, confidence: 0.7 };

function bundle(overrides: Record<string, unknown>): unknown {
  return { framePath: ['content'], strategies: [textStrategy], matchPolicy: 'unique', describedAs: 'Search button', ...overrides };
}

describe('LocatorBundle', () => {
  it('accepts a bundle with a unique match policy', () => {
    expect(LocatorBundle.safeParse(bundle({})).success).toBe(true);
  });

  it('rejects a visual strategy, because nothing would ever execute one', () => {
    const result = LocatorBundle.safeParse(bundle({ strategies: [{ kind: 'visual', confidence: 0.1 }] }));

    expect(result.success).toBe(false);
  });

  it('rejects a first match policy, because silently taking the first match clicks the wrong account', () => {
    expect(LocatorBundle.safeParse(bundle({ matchPolicy: 'first' })).success).toBe(false);
  });

  it('requires nth when the policy is nth', () => {
    const result = LocatorBundle.safeParse(bundle({ matchPolicy: 'nth' }));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['nth']);
  });

  it('refuses nth when the policy is unique', () => {
    expect(LocatorBundle.safeParse(bundle({ nth: 2 })).success).toBe(false);
  });
});
