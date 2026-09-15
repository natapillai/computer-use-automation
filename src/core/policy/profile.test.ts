import { describe, expect, it } from 'vitest';
import profileJson from '../../../profiles/meridian-core.json' with { type: 'json' };
import { observationOf } from '../../../tests/fixtures/surface/nodes.js';
import { meridianScript } from '../../../tests/fixtures/surface/meridianScreens.js';
import type { EvaluationContext } from '../outcome/evaluate.js';
import { matchStrategy } from '../surfaceModel/match.js';
import type { Observation } from '../surfaceModel/types.js';
import { ACTION_VERBS } from '../surfaceModel/types.js';
import { Allowlist } from './allowlist.js';
import { AppProfile, authorizeRequest, classifyRequest, profileCondition, sensitiveFields, type StepEffect } from './profile.js';

// The committed profile, so these tests fail if the file drifts from what the system needs.
const profile = AppProfile.parse(profileJson);

const allowlist = Allowlist.parse({
  version: 1,
  origins: [
    {
      pattern: 'http://localhost:4010',
      description: 'Local MERIDIAN Core target app',
      allowedPaths: ['/servicing/**', '/member/**', '/auth/login', '/favicon.ico', '/'],
      deniedPaths: ['/admin/**', '/__control__/**', '/**/delete', '/**/wire/**'],
    },
  ],
  actions: { allowed: [...ACTION_VERBS], denied: [] },
  risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
  budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
  data: { neverPersist: [], redactPatterns: [] },
});

const at = (path: string): string => `http://localhost:4010${path}`;
const readStep: StepEffect = { stepId: 'submitSearch', effect: 'read' };
const writeStep: StepEffect = { stepId: 'submitSubAccount', effect: 'write' };

describe('AppProfile', () => {
  it('refuses a profile condition that declares a business outcome, which only a capability may do', () => {
    const invalid = { ...profileJson, conditions: [{ when: { kind: 'dialogPresent' }, classify: 'business_outcome', code: 'MEMBER_NOT_FOUND' }] };

    expect(AppProfile.safeParse(invalid).success).toBe(false);
  });
});

describe('classifyRequest', () => {
  it('classifies the member search POST as a read that is not idempotent', () => {
    expect(classifyRequest(profile, 'POST', at('/servicing/search'))).toEqual({ effect: 'read', idempotent: false, classified: true });
  });

  it('classifies member detail by its path pattern and ignores the query string', () => {
    expect(classifyRequest(profile, 'GET', at('/member/10001?tab=accounts'))).toEqual({ effect: 'read', idempotent: true, classified: true });
  });

  it('classifies the sub account submit as a write', () => {
    expect(classifyRequest(profile, 'POST', at('/member/10001/subaccount'))).toEqual({ effect: 'write', idempotent: false, classified: true });
  });

  it('treats a route the profile does not list as a write that is not idempotent', () => {
    expect(classifyRequest(profile, 'POST', at('/reports/run'))).toEqual({ effect: 'write', idempotent: false, classified: false });
    expect(classifyRequest(profile, 'GET', at('/member/10001/subaccount/extra'))).toMatchObject({ classified: false });
  });

  it('tells methods apart', () => {
    expect(classifyRequest(profile, 'DELETE', at('/member/10001'))).toEqual({ effect: 'write', idempotent: false, classified: false });
  });
});

describe('authorizeRequest', () => {
  const decide = (step: StepEffect | null, method: string, path: string) => authorizeRequest({ allowlist, profile, step, method, url: at(path) });

  it('lets a read step make read requests, including the POST a search sends', () => {
    expect(decide(readStep, 'POST', '/servicing/search')).toEqual({ allowed: true });
    expect(decide(readStep, 'GET', '/member/10001')).toEqual({ allowed: true });
  });

  it('refuses a write request while a read step runs', () => {
    expect(decide(readStep, 'POST', '/member/10001/subaccount')).toMatchObject({ allowed: false, rule: 'effect' });
  });

  it('refuses an unclassified request during any step', () => {
    expect(decide(readStep, 'POST', '/servicing/export')).toMatchObject({ allowed: false, rule: 'unclassified' });
    expect(decide(writeStep, 'GET', '/servicing/export')).toMatchObject({ allowed: false, rule: 'unclassified' });
  });

  it('lets a write step make the write the profile classifies', () => {
    expect(decide(writeStep, 'POST', '/member/10001/subaccount')).toEqual({ allowed: true });
  });

  it('applies only the allowlist outside a step, which is the window a person holds', () => {
    expect(decide(null, 'POST', '/member/10001/subaccount')).toEqual({ allowed: true });
    expect(decide(null, 'GET', '/__control__/state')).toMatchObject({ allowed: false, rule: 'deniedPath' });
  });

  it('lets the allowlist deny before the profile is consulted', () => {
    expect(decide(readStep, 'GET', '/__control__/reset')).toMatchObject({ allowed: false, rule: 'deniedPath' });
  });

  it('never repeats the url in a reason', () => {
    expect(JSON.stringify(decide(readStep, 'POST', '/member/10001/subaccount'))).not.toContain('10001');
  });
});

describe('sensitiveFields', () => {
  it('marks the member number, name and balance cells pii and the card secret, and leaves labels alone', () => {
    const detail = meridianScript().screens['detail'];
    if (detail === undefined) throw new Error('The scripted detail screen is missing.');

    expect(Object.fromEntries(sensitiveFields(profile, detail))).toEqual({ d2: 'pii', d4: 'pii', d6: 'secret', s3: 'pii' });
  });
});

describe('profileCondition', () => {
  function contextFor(observation: Observation): EvaluationContext {
    return { observation, match: async (strategy, framePath) => matchStrategy(observation, strategy, framePath), outputResolvable: async () => false };
  }

  it('classifies a redirect to the login page as SessionExpired', async () => {
    expect(await profileCondition(profile, contextFor(observationOf([], 'http://localhost:4010/auth/login')))).toEqual({ classify: 'failure', code: 'SessionExpired' });
  });

  it('stays silent on an ordinary page', async () => {
    expect(await profileCondition(profile, contextFor(observationOf([])))).toBeNull();
  });
});
