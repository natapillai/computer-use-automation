import { describe, expect, it } from 'vitest';
import { checkLiveModelKey, parseModelEnv, parseTargetEnv } from './env.js';

describe('parseTargetEnv', () => {
  it('parses a complete environment into typed config with defaults applied', () => {
    const result = parseTargetEnv({ TARGET_USERNAME: 'operator', TARGET_PASSWORD: 'fixture-pass' });

    expect(result).toEqual({
      ok: true,
      value: {
        targetBaseUrl: 'http://localhost:4010',
        targetUsername: 'operator',
        targetPassword: 'fixture-pass',
        interventionClaimTimeoutMs: 300_000,
      },
    });
  });

  it('fails fast naming every missing credential, because no secret has a default', () => {
    const result = parseTargetEnv({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.variables).toEqual(['TARGET_USERNAME', 'TARGET_PASSWORD']);
    expect(result.error.message).toBe(
      'Invalid environment. TARGET_USERNAME is required. TARGET_PASSWORD is required.',
    );
  });

  it('names a variable that is present but malformed', () => {
    const result = parseTargetEnv({
      TARGET_USERNAME: 'operator',
      TARGET_PASSWORD: 'fixture-pass',
      TARGET_BASE_URL: 'not a url',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.variables).toEqual(['TARGET_BASE_URL']);
    expect(result.error.message).toContain('TARGET_BASE_URL is invalid');
  });
});

describe('parseModelEnv', () => {
  it('requires ANTHROPIC_MODEL, because the model id lives in config and not in code', () => {
    const result = parseModelEnv({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.variables).toEqual(['ANTHROPIC_MODEL']);
  });

  it('parses the configured model id', () => {
    expect(parseModelEnv({ ANTHROPIC_MODEL: 'claude-sonnet-5' })).toEqual({
      ok: true,
      value: { model: 'claude-sonnet-5' },
    });
  });
});

describe('checkLiveModelKey', () => {
  it('fails naming ANTHROPIC_API_KEY when it is absent or empty, so a live run cannot start by accident', () => {
    const refusal = {
      ok: false,
      error: { kind: 'EnvInvalid', message: 'Invalid environment. ANTHROPIC_API_KEY is required for a live discovery run.', variables: ['ANTHROPIC_API_KEY'] },
    };

    expect(checkLiveModelKey({})).toEqual(refusal);
    expect(checkLiveModelKey({ ANTHROPIC_API_KEY: '' })).toEqual(refusal);
  });

  it('passes when a key is present and never repeats it', () => {
    const result = checkLiveModelKey({ ANTHROPIC_API_KEY: 'not-a-real-key' });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('not-a-real-key');
  });
});
