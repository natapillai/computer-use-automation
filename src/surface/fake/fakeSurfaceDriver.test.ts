import { describe, expect, it } from 'vitest';
import { box, disabled, observationOf, uiNode } from '../../../tests/fixtures/surface/nodes.js';
import { ControlLostError, createControlTokens } from '../../control/controlToken.js';
import type { LocatorBundle } from '../../core/locator/schema.js';
import { findNodeByRef } from '../../core/surfaceModel/tree.js';
import { createTestClock, type Clock } from '../../runtime/clock.js';
import { createSequentialIds } from '../../runtime/ids.js';
import { createFakeSurfaceDriver, type FakeScript } from './fakeSurfaceDriver.js';

const heading = uiNode('h1', 'heading', 'Member Search', box(8, 8, 600, 18));

const searchScreen = observationOf([
  heading,
  uiNode('n2', 'cell', 'Member  ID:', box(8, 40, 80, 20)),
  uiNode('n3', 'textbox', '', box(92, 40, 100, 20), { derivedLabel: 'Member  ID:' }),
  uiNode('n6', 'cell', 'Search', box(92, 90, 60, 20), { clickableHint: true }),
  uiNode('n8', 'cell', 'Export', box(160, 90, 60, 20), { state: disabled }),
]);

const resultsScreen = observationOf([heading, uiNode('r1', 'link', '10001', box(8, 120, 40, 14))]);

const script: FakeScript = {
  start: 'search',
  screens: { search: searchScreen, results: resultsScreen },
  transitions: [
    { from: 'search', on: { kind: 'click', ref: 'n6' }, to: 'results' },
    { from: 'results', on: { kind: 'navigate', path: '/servicing/search' }, to: 'search' },
  ],
};

const memberIdField: LocatorBundle = {
  framePath: ['content'],
  strategies: [
    {
      kind: 'anchor-relative',
      anchor: { kind: 'text', text: 'Member ID:', exact: false, confidence: 0.8 },
      relation: 'sameRow',
      role: 'textbox',
      confidence: 0.8,
    },
  ],
  matchPolicy: 'unique',
  describedAs: 'Member ID input',
};

function setup(clock?: Clock) {
  const tokens = createControlTokens('sess_000001', createSequentialIds());
  const driver = createFakeSurfaceDriver({ sessionId: 'sess_000001', control: tokens, script, ...(clock === undefined ? {} : { clock }) });
  return { tokens, driver, token: tokens.issue('automation') };
}

describe('FakeSurfaceDriver', () => {
  it('returns the scripted observation for the current screen', async () => {
    const { driver } = setup();

    expect(driver.screen).toBe('search');
    expect(await driver.observe()).toEqual(searchScreen);
  });

  it('moves to the scripted screen when a scripted trigger fires', async () => {
    const { driver, token } = setup();

    expect(await driver.act({ kind: 'click', ref: 'n6' }, token)).toEqual({ ok: true });
    expect(driver.screen).toBe('results');
    expect(await driver.observe()).toEqual(resultsScreen);
  });

  it('stays on the screen after an unscripted click, the way a dead control does', async () => {
    const { driver, token } = setup();

    expect(await driver.act({ kind: 'click', ref: 'n2' }, token)).toEqual({ ok: true });
    expect(driver.screen).toBe('search');
  });

  it('writes a filled value into the observed node', async () => {
    const { driver, token } = setup();

    await driver.act({ kind: 'fill', ref: 'n3', value: '10001' }, token);

    expect(findNodeByRef((await driver.observe()).root, 'n3')?.value).toBe('10001');
  });

  it('reports a ref absent from the current screen as not_found and a disabled node as disabled', async () => {
    const { driver, token } = setup();

    expect(await driver.act({ kind: 'click', ref: 'r1' }, token)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await driver.act({ kind: 'click', ref: 'n8' }, token)).toMatchObject({ ok: false, reason: 'disabled' });
  });

  it('navigates only along a scripted path', async () => {
    const { driver, token } = setup();
    const navigate = { kind: 'navigate', path: '/servicing/search', framePath: ['content'] } as const;

    expect(await driver.act(navigate, token)).toMatchObject({ ok: false, reason: 'navigation_failed' });
    await driver.act({ kind: 'click', ref: 'n6' }, token);
    expect(await driver.act(navigate, token)).toEqual({ ok: true });
    expect(driver.screen).toBe('search');
  });

  it('rejects a stale token with ControlLostError before touching the surface', async () => {
    const { tokens, driver, token: stale } = setup();
    tokens.issue('human');

    await expect(driver.act({ kind: 'click', ref: 'n6' }, stale)).rejects.toBeInstanceOf(ControlLostError);
    await expect(driver.resolve(memberIdField, stale)).rejects.toBeInstanceOf(ControlLostError);
    expect(driver.screen).toBe('search');
    expect(driver.performed).toEqual([]);
  });

  it('records each action it performed, in order', async () => {
    const { driver, token } = setup();

    await driver.act({ kind: 'fill', ref: 'n3', value: '10001' }, token);
    await driver.act({ kind: 'click', ref: 'n6' }, token);

    expect(driver.performed).toEqual([
      { kind: 'fill', ref: 'n3', value: '10001' },
      { kind: 'click', ref: 'n6' },
    ]);
  });

  it('resolves a bundle through the core resolver over the current observation', async () => {
    const { driver, token } = setup();

    expect(await driver.resolve(memberIdField, token)).toMatchObject({ ok: true, ref: 'n3', drift: null });
    expect(await driver.match({ kind: 'text', text: 'Search', exact: true, confidence: 0.6 }, ['content'])).toEqual(['n6']);
  });

  it('reports the url of a frame by path, and null for a frame that does not exist', async () => {
    const { driver } = setup();

    expect(await driver.frameUrl(['content'])).toBe('http://localhost:4010/servicing/search');
    expect(await driver.frameUrl([])).toBe('http://localhost:4010/servicing');
    expect(await driver.frameUrl(['missing'])).toBeNull();
  });

  it('reports a change made since the last observation at once, without spending time', async () => {
    const clock = createTestClock('2026-09-14T09:00:00.000Z');
    const { driver, token } = setup(clock);
    await driver.observe();
    await driver.act({ kind: 'click', ref: 'n6' }, token);

    expect(await driver.waitForChange(1_000)).toBe('changed');
    expect(clock.now().toISOString()).toBe('2026-09-14T09:00:00.000Z');
  });

  it('spends the whole timeout on its clock when nothing changes', async () => {
    const clock = createTestClock('2026-09-14T09:00:00.000Z');
    const { driver } = setup(clock);
    await driver.observe();

    expect(await driver.waitForChange(1_000)).toBe('timeout');
    expect(clock.now().toISOString()).toBe('2026-09-14T09:00:01.000Z');
  });

  it('refuses a script whose transition names a screen that does not exist', () => {
    const tokens = createControlTokens('sess_000001', createSequentialIds());
    const broken: FakeScript = { ...script, transitions: [{ from: 'search', on: { kind: 'click', ref: 'n6' }, to: 'detail' }] };

    expect(() => createFakeSurfaceDriver({ sessionId: 'sess_000001', control: tokens, script: broken })).toThrow(TypeError);
  });
});
