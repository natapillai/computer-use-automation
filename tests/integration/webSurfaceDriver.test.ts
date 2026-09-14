import type { Server } from 'node:http';
import { chromium, type Browser, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { ControlLostError, createControlTokens, type ControlToken, type SessionControlTokens } from '../../src/control/controlToken.js';
import type { LocatorBundle, LocatorStrategy } from '../../src/core/locator/schema.js';
import { findNodeByRef, walkNodes } from '../../src/core/surfaceModel/tree.js';
import type { UINode } from '../../src/core/surfaceModel/types.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import type { SurfaceDriver } from '../../src/surface/types.js';
import { createWebSurfaceDriver } from '../../src/surface/web/webSurfaceDriver.js';

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
    {
      kind: 'anchor-relative',
      anchor: { kind: 'role-name', role: 'heading', name: 'Member Search', exact: true, confidence: 0.9 },
      relation: 'firstBelow',
      role: 'textbox',
      confidence: 0.6,
    },
  ],
  matchPolicy: 'unique',
  describedAs: 'Member ID input',
};

const surnameField: LocatorBundle = {
  ...memberIdField,
  strategies: [
    {
      kind: 'anchor-relative',
      anchor: { kind: 'text', text: 'Surname:', exact: true, confidence: 0.8 },
      relation: 'sameRow',
      role: 'textbox',
      confidence: 0.8,
    },
  ],
  describedAs: 'Surname input',
};

const searchButton: LocatorBundle = {
  framePath: ['content'],
  strategies: [{ kind: 'role-name', role: 'cell', name: 'Search', exact: true, confidence: 0.7 }],
  matchPolicy: 'unique',
  describedAs: 'Search button',
};

const resultLink: LocatorStrategy = { kind: 'role-name', role: 'link', name: '10001', exact: true, confidence: 0.9 };

describe('WebSurfaceDriver against MERIDIAN Core', { timeout: 30_000 }, () => {
  let server: Server;
  let base: string;
  let browser: Browser;
  let page: Page;
  let tokens: SessionControlTokens;
  let token: ControlToken;
  let driver: SurfaceDriver;

  beforeAll(async () => {
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed: 'web-driver' });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1024, height: 700 } });
    await context.request.post(`${base}/auth/login`, {
      form: { username: 'operator', password: 'meridian-fixture' },
      maxRedirects: 0,
    });
    page = await context.newPage();
    tokens = createControlTokens('sess_000001', createSequentialIds());
    driver = createWebSurfaceDriver({ page, sessionId: 'sess_000001', control: tokens, baseUrl: base });
  }, 30_000);

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    token = tokens.issue('automation');
    await page.goto(`${base}/servicing`);
  });

  function contentFrame(): Frame {
    const frame = page.frame({ name: 'content' });
    if (frame === null) throw new Error('The content frame is missing.');
    return frame;
  }

  async function resolvedNode(bundle: LocatorBundle): Promise<UINode> {
    const resolution = await driver.resolve(bundle, token);
    if (!resolution.ok) throw new Error(`${bundle.describedAs} did not resolve.`);
    const found = findNodeByRef((await driver.observe()).root, resolution.ref);
    if (found === null) throw new Error(`${bundle.describedAs} resolved to a ref that is not in the observation.`);
    return found;
  }

  it('resolves the member ID input through anchor-relative although it has no accessible name', async () => {
    const resolution = await driver.resolve(memberIdField, token);

    expect(resolution).toMatchObject({ ok: true, drift: null });
    expect(await resolvedNode(memberIdField)).toMatchObject({
      role: 'textbox',
      name: '',
      derivedLabel: 'Member ID:',
      framePath: ['content'],
    });
  });

  it('binds each input to its own label', async () => {
    const memberId = await resolvedNode(memberIdField);
    const surname = await resolvedNode(surnameField);

    expect(surname.derivedLabel).toBe('Surname:');
    expect(surname.ref).not.toBe(memberId.ref);
  });

  it('observes every frame with its path, its url and the status that loaded it', async () => {
    const observation = await driver.observe();

    expect(observation.frames).toEqual(
      expect.arrayContaining([
        { framePath: [], url: `${base}/servicing`, lastStatus: 200 },
        { framePath: ['content'], url: `${base}/servicing/search`, lastStatus: 200 },
      ]),
    );
  });

  it('reads the live url of a frame by path, and null for a frame that does not exist', async () => {
    expect(await driver.frameUrl(['content'])).toBe(`${base}/servicing/search`);
    expect(await driver.frameUrl([])).toBe(`${base}/servicing`);
    expect(await driver.frameUrl(['missing'])).toBeNull();
  });

  it('gives refs in document order with no duplicates', async () => {
    const refs = [...walkNodes((await driver.observe()).root)].map((node) => node.ref);

    expect(new Set(refs).size).toBe(refs.length);
  });

  it('hints the td onclick submit as clickable and not the nav link, which has a real role', async () => {
    const observation = await driver.observe();
    const [searchRef] = await driver.match(searchButton.strategies[0] ?? resultLink, ['content']);
    const [navRef] = await driver.match({ kind: 'role-name', role: 'link', name: 'Member Search', exact: true, confidence: 0.9 }, ['nav']);

    expect(findNodeByRef(observation.root, searchRef ?? '')?.clickableHint).toBe(true);
    expect(findNodeByRef(observation.root, navRef ?? '')?.clickableHint).toBe(false);
  });

  it('fills through a ref and reads the value back from the next observation', async () => {
    expect(await driver.act({ kind: 'fill', ref: (await resolvedNode(memberIdField)).ref, value: '10001' }, token)).toEqual({ ok: true });

    expect((await resolvedNode(memberIdField)).value).toBe('10001');
  });

  it('clicks the td onclick submit and reaches the result row inside the content frame', async () => {
    await driver.act({ kind: 'fill', ref: (await resolvedNode(memberIdField)).ref, value: '10001' }, token);
    const search = await driver.resolve(searchButton, token);
    if (!search.ok) throw new Error('The search button did not resolve.');

    const landed = page.waitForEvent('framenavigated', (frame) => frame.name() === 'content');
    expect(await driver.act({ kind: 'click', ref: search.ref }, token)).toEqual({ ok: true });
    await landed;
    await contentFrame().waitForLoadState('load');

    await driver.observe();
    expect(await driver.match(resultLink, ['content'])).toHaveLength(1);
    expect(await driver.match(resultLink, [])).toEqual([]);
  });

  it('waits for the content frame to change after a click, and times out when nothing changes', async () => {
    await driver.act({ kind: 'fill', ref: (await resolvedNode(memberIdField)).ref, value: '10001' }, token);
    const search = await driver.resolve(searchButton, token);
    if (!search.ok) throw new Error('The search button did not resolve.');
    await driver.act({ kind: 'click', ref: search.ref }, token);

    expect(await driver.waitForChange(10_000)).toBe('changed');

    await contentFrame().waitForLoadState('load');
    await driver.observe();
    expect(await driver.waitForChange(300)).toBe('timeout');
  });

  it('refuses a ref whose element changed under it instead of acting on whatever the ref names now', async () => {
    const input = await resolvedNode(memberIdField);
    await contentFrame().goto(`${base}/member/10001`);

    expect(await driver.act({ kind: 'fill', ref: input.ref, value: '99999' }, token)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await contentFrame().content()).not.toContain('99999');
  });

  it('navigates a frame by its path and refuses a frame path that does not exist', async () => {
    expect(await driver.act({ kind: 'navigate', path: '/member/10001', framePath: ['content'] }, token)).toEqual({ ok: true });
    expect(new URL(contentFrame().url()).pathname).toBe('/member/10001');

    expect(await driver.act({ kind: 'navigate', path: '/servicing/search', framePath: ['missing'] }, token)).toMatchObject({
      ok: false,
      reason: 'navigation_failed',
    });
  });

  it('rejects a stale token before touching the page', async () => {
    tokens.issue('human');

    await expect(driver.act({ kind: 'navigate', path: '/member/10001', framePath: ['content'] }, token)).rejects.toBeInstanceOf(ControlLostError);
    expect(new URL(contentFrame().url()).pathname).toBe('/servicing/search');
  });
});
