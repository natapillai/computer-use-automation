import { describe, expect, it } from 'vitest';
import { box, observationOf, uiNode } from '../../tests/fixtures/surface/nodes.js';
import { ControlLostError, createControlTokens } from '../control/controlToken.js';
import { Allowlist } from '../core/policy/allowlist.js';
import { createGrantLedger, type GrantLedger, type PolicyContext } from '../core/policy/authorize.js';
import { ACTION_VERBS } from '../core/surfaceModel/types.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver, type FakeSurfaceDriver } from './fake/fakeSurfaceDriver.js';
import { createGuardedSurface, type GuardedAction } from './guardedSurface.js';
import { createStepScope } from './stepScope.js';

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
  data: { neverPersist: ['password'], redactPatterns: [] },
});

const searchCell = uiNode('n6', 'cell', 'Search', box(92, 90, 60, 20), { clickableHint: true });

function setup(contentUrl = 'http://localhost:4010/servicing/search', grants: GrantLedger = createGrantLedger()) {
  const tokens = createControlTokens('sess_000001', createSequentialIds());
  const driver: FakeSurfaceDriver = createFakeSurfaceDriver({
    sessionId: 'sess_000001',
    control: tokens,
    script: {
      start: 'search',
      screens: {
        search: observationOf([searchCell], contentUrl),
        results: observationOf([uiNode('r1', 'link', '10001', box(8, 120, 40, 14))], contentUrl),
      },
      transitions: [
        { from: 'search', on: { kind: 'click', ref: 'n6' }, to: 'results' },
        { from: 'search', on: { kind: 'navigate', path: '/servicing/search' }, to: 'search' },
      ],
    },
  });
  const policy: PolicyContext = { allowlist, phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants };
  const scope = createStepScope();
  const surface = createGuardedSurface({ driver, policy, runId: 'run_000001', baseUrl: 'http://localhost:4010', scope });
  return { tokens, driver, surface, scope, token: tokens.issue('automation') };
}

function click(overrides: Partial<GuardedAction> = {}): GuardedAction {
  return { action: { kind: 'click', ref: 'n6' }, framePath: ['content'], stepId: 'submitSearch', effect: 'read', targetKey: 'Search button', ...overrides };
}

function navigate(path: string): GuardedAction {
  return { action: { kind: 'navigate', path, framePath: ['content'] }, framePath: ['content'], stepId: 'openSearch', effect: 'read', targetKey: null };
}

describe('GuardedSurface', () => {
  it('performs an allowed read and hands back what the driver returned', async () => {
    const { driver, surface, token } = setup();

    expect(await surface.perform(click(), token)).toEqual({ kind: 'performed', result: { ok: true } });
    expect(driver.screen).toBe('results');
  });

  it('never lets a denied navigation reach the driver', async () => {
    const { driver, surface, token } = setup();

    expect(await surface.perform(navigate('/__control__/reset'), token)).toMatchObject({ kind: 'denied', decision: { rule: 'deniedPath' } });
    expect(driver.performed).toEqual([]);
  });

  it('denies a protocol relative path that would leave the origin', async () => {
    const { driver, surface, token } = setup();

    expect(await surface.perform(navigate('//evil.localhost:4010/servicing/search'), token)).toMatchObject({
      kind: 'denied',
      decision: { rule: 'origin' },
    });
    expect(driver.performed).toEqual([]);
  });

  it('authorizes an element action against the url of the frame it lands in', async () => {
    const { driver, surface, token } = setup('http://localhost:4010/admin/users');

    expect(await surface.perform(click(), token)).toMatchObject({ kind: 'denied', decision: { rule: 'deniedPath' } });
    expect(driver.performed).toEqual([]);
  });

  it('denies an element action aimed at a frame that does not exist', async () => {
    const { driver, surface, token } = setup();

    expect(await surface.perform(click({ framePath: ['missing'] }), token)).toMatchObject({ kind: 'denied', decision: { rule: 'url' } });
    expect(driver.performed).toEqual([]);
  });

  it('asks for confirmation on a write in a draft replay and leaves the page alone', async () => {
    const { driver, surface, token } = setup();

    expect(await surface.perform(click({ effect: 'write' }), token)).toMatchObject({ kind: 'confirm', decision: { effect: 'write' } });
    expect(driver.performed).toEqual([]);
  });

  it('performs a write once against a grant bound to this run, step and target', async () => {
    const grants = createGrantLedger();
    grants.issue({ runId: 'run_000001', stepId: 'submitSearch', targetKey: 'Search button' });
    const { driver, surface, token } = setup(undefined, grants);

    expect(await surface.perform(click({ effect: 'write' }), token)).toMatchObject({ kind: 'performed' });
    expect(await surface.perform(click({ effect: 'write' }), token)).toMatchObject({ kind: 'confirm' });
    expect(driver.performed).toHaveLength(1);
  });

  it('enters the step scope before acting, so the network guard judges what the step causes', async () => {
    const { surface, scope, token } = setup();

    await surface.perform(click(), token);

    expect(scope.current()).toEqual({ stepId: 'submitSearch', effect: 'read' });
  });

  it('leaves the step scope alone when the action is denied', async () => {
    const { surface, scope, token } = setup();

    await surface.perform(navigate('/__control__/reset'), token);

    expect(scope.current()).toBeNull();
  });

  it('reports the refusals recorded during a step for that step only', async () => {
    const { surface, scope, token } = setup();
    await surface.perform(click(), token);
    scope.refuse('effect');
    scope.enter({ stepId: 'openMemberDetail', effect: 'read' });
    scope.refuse('origin');

    expect(surface.refusalsFor('submitSearch')).toEqual([{ stepId: 'submitSearch', rule: 'effect' }]);
    expect(scope.refusals()).toEqual([
      { stepId: 'submitSearch', rule: 'effect' },
      { stepId: 'openMemberDetail', rule: 'origin' },
    ]);
  });

  it('passes the control token through, so a stale token still fails in the driver', async () => {
    const { tokens, surface, token } = setup();
    tokens.issue('human');

    await expect(surface.perform(click(), token)).rejects.toBeInstanceOf(ControlLostError);
  });
});
