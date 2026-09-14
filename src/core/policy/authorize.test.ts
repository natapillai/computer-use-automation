import { describe, expect, it } from 'vitest';
import { ACTION_VERBS } from '../surfaceModel/types.js';
import { Allowlist } from './allowlist.js';
import { authorize, createGrantLedger, type PolicyContext, type ProposedAction } from './authorize.js';

const allowlist = Allowlist.parse({
  version: 1,
  origins: [
    {
      pattern: 'http://localhost:4010',
      description: 'Local MERIDIAN Core target app',
      allowedPaths: ['/servicing/**', '/member/**', '/auth/login'],
      deniedPaths: ['/admin/**', '/__control__/**', '/**/delete', '/**/wire/**'],
    },
  ],
  actions: { allowed: [...ACTION_VERBS], denied: ['upload', 'download', 'execScript', 'newTab', 'clipboardRead'] },
  risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
  budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
  data: { neverPersist: ['password', 'token'], redactPatterns: [] },
});

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    kind: 'click',
    url: 'http://localhost:4010/servicing/search',
    runId: 'run_000001',
    stepId: 'submitSearch',
    targetKey: 'Search button',
    effect: 'read',
    ...overrides,
  };
}

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    allowlist,
    phase: 'replay',
    capabilityStatus: 'draft',
    allowUnattendedReplay: false,
    grants: createGrantLedger(),
    ...overrides,
  };
}

describe('authorize', () => {
  it('allows a read on an allowed path of an allowed origin', () => {
    expect(authorize(action(), context())).toEqual({ verdict: 'allow' });
  });

  it('denies every origin that is not an exact scheme, host and port match', () => {
    for (const url of [
      'http://localhost:4011/servicing/search',
      'https://localhost:4010/servicing/search',
      'http://evil.localhost:4010/servicing/search',
      'http://127.0.0.1:4010/servicing/search',
    ]) {
      expect(authorize(action({ url }), context())).toMatchObject({ verdict: 'deny', rule: 'origin' });
    }
  });

  it('denies an action kind the allowlist denies, and one it never mentions', () => {
    expect(authorize(action({ kind: 'execScript' }), context())).toMatchObject({ verdict: 'deny', rule: 'action' });
    expect(authorize(action({ kind: 'teleport' }), context())).toMatchObject({ verdict: 'deny', rule: 'action' });
  });

  it('lets a denied path beat an allowed path that also covers it', () => {
    expect(authorize(action({ url: 'http://localhost:4010/member/10001/delete' }), context())).toMatchObject({
      verdict: 'deny',
      rule: 'deniedPath',
    });
  });

  it('denies a path that no allowed pattern covers', () => {
    expect(authorize(action({ url: 'http://localhost:4010/reports/daily' }), context())).toMatchObject({
      verdict: 'deny',
      rule: 'path',
    });
  });

  it('keeps automation out of the fault injection controls', () => {
    expect(authorize(action({ url: 'http://localhost:4010/__control__/fault' }), context())).toMatchObject({
      verdict: 'deny',
      rule: 'deniedPath',
    });
  });

  it('matches paths without the query string, and a trailing ** covers the bare prefix', () => {
    expect(authorize(action({ url: 'http://localhost:4010/servicing/search?page=2' }), context())).toEqual({ verdict: 'allow' });
    expect(authorize(action({ kind: 'navigate', url: 'http://localhost:4010/servicing' }), context())).toEqual({ verdict: 'allow' });
  });

  it('does not echo the path in a denial, because a path can carry a member ID', () => {
    const decision = authorize(action({ url: 'http://localhost:4010/member/10001/delete' }), context());

    expect(JSON.stringify(decision)).not.toContain('10001');
  });

  it('refuses a url it cannot parse', () => {
    expect(authorize(action({ url: 'not a url' }), context())).toMatchObject({ verdict: 'deny', rule: 'url' });
  });

  it('asks for confirmation on a write during discovery and during a draft replay', () => {
    const write = action({ effect: 'write' });

    expect(authorize(write, context({ phase: 'discovery', capabilityStatus: null }))).toMatchObject({ verdict: 'confirm', effect: 'write' });
    expect(authorize(write, context({ phase: 'replay', capabilityStatus: 'draft' }))).toMatchObject({ verdict: 'confirm' });
  });

  it('allows a write unattended only when the capability is approved and allows it', () => {
    const write = action({ effect: 'write' });

    expect(authorize(write, context({ capabilityStatus: 'approved', allowUnattendedReplay: true }))).toEqual({ verdict: 'allow' });
    expect(authorize(write, context({ capabilityStatus: 'approved', allowUnattendedReplay: false }))).toMatchObject({ verdict: 'confirm' });
  });

  it('accepts a one shot approval grant exactly once', () => {
    const grants = createGrantLedger();
    const write = action({ effect: 'write' });
    grants.issue({ runId: 'run_000001', stepId: 'submitSearch', targetKey: 'Search button' });

    expect(authorize(write, context({ grants }))).toEqual({ verdict: 'allow' });
    expect(authorize(write, context({ grants }))).toMatchObject({ verdict: 'confirm' });
  });

  it('binds a grant to its run, step and target', () => {
    const grants = createGrantLedger();
    grants.issue({ runId: 'run_000001', stepId: 'openSubAccount', targetKey: 'Submit button' });

    expect(authorize(action({ effect: 'write' }), context({ grants }))).toMatchObject({ verdict: 'confirm' });
    expect(authorize(action({ effect: 'write', runId: 'run_000002', stepId: 'openSubAccount', targetKey: 'Submit button' }), context({ grants }))).toMatchObject({
      verdict: 'confirm',
    });
  });
});
