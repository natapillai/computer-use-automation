import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createSessionControl } from '../../src/control/controlPlane.js';
import { createControlTokens } from '../../src/control/controlToken.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import { createRunConsole } from '../../src/escalation/runConsole.js';
import { maskedScreenshot } from '../../src/evidence/maskedScreenshot.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createGuardedSurface } from '../../src/surface/guardedSurface.js';
import { allowlistFor } from '../fixtures/policy/allowlist.js';
import { meridianProfile } from '../fixtures/profile.js';
import { matchStrategy } from '../../src/core/surfaceModel/match.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { createWebSurfaceDriver } from '../../src/surface/web/webSurfaceDriver.js';

// A masked region must be absent from the stored image, proven by reading pixels back
// rather than trusting the option was passed.
describe('masked screenshots of member detail', { timeout: 30_000 }, () => {
  let server: Server;
  let base: string;
  let browser: Browser;

  beforeAll(async () => {
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed: 'mask' });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Decodes the PNG in a blank page and samples one pixel, so no image library is needed.
  // The page code is a string because this project compiles without DOM types.
  async function pixelAt(decoder: Page, png: Uint8Array, x: number, y: number): Promise<number[]> {
    const dataUrl = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    const rgb: unknown = await decoder.evaluate(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(dataUrl)};
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(${Math.round(x)}, ${Math.round(y)}, 1, 1).data.slice(0, 3));
    })()`);
    if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every((channel) => typeof channel === 'number')) throw new Error('The decoder returned no pixel.');
    return rgb;
  }

  it('paints over the balance cell inside the content frame and leaves the account name visible', async () => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 700 } });
    await context.request.post(`${base}/auth/login`, { form: { username: 'operator', password: 'meridian-fixture' }, maxRedirects: 0 });
    const page = await context.newPage();
    const decoder = await context.newPage();
    const tokens = createControlTokens('sess_mask', createSequentialIds());
    const driver = createWebSurfaceDriver({ page, sessionId: 'sess_mask', control: tokens, baseUrl: base });
    const token = tokens.issue('automation');

    await driver.act({ kind: 'navigate', path: '/servicing', framePath: [] }, token);
    await driver.act({ kind: 'navigate', path: '/member/10001', framePath: ['content'] }, token);
    const observation = await driver.observe();
    const [balanceRef] = matchStrategy(
      observation,
      { kind: 'anchor-relative', anchor: { kind: 'text', text: 'Savings', exact: true, confidence: 1 }, relation: 'rightOf', role: 'cell', confidence: 1 },
      ['content'],
    );
    if (balanceRef === undefined) throw new Error('The balance cell did not resolve.');

    const balanceBox = await page.locator(`aria-ref=${balanceRef}`).boundingBox();
    const nameBox = await page.frameLocator('frame[name="content"]').getByRole('cell', { name: 'Savings', exact: true }).boundingBox();
    if (balanceBox === null || nameBox === null) throw new Error('A cell has no box on the page.');
    const centre = (box: { x: number; y: number; width: number; height: number }) => [box.x + box.width / 2, box.y + box.height / 2] as const;

    const unmasked = await driver.screenshot([]);
    const masked = await driver.screenshot([balanceRef]);

    expect(Array.from(masked.slice(0, 4))).toEqual([137, 80, 78, 71]);
    expect(await pixelAt(decoder, unmasked, ...centre(balanceBox))).not.toEqual([255, 0, 255]);
    for (const [dx, dy] of [[0, 0], [-balanceBox.width / 3, 0], [balanceBox.width / 3, 0], [0, -balanceBox.height / 4], [0, balanceBox.height / 4]]) {
      const [cx, cy] = centre(balanceBox);
      expect(await pixelAt(decoder, masked, cx + (dx ?? 0), cy + (dy ?? 0))).toEqual([255, 0, 255]);
    }
    expect(await pixelAt(decoder, masked, ...centre(nameBox))).not.toEqual([255, 0, 255]);

    await context.close();
  });
  it('serves the console the same masked image, which is what a person is actually shown', async () => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 700 } });
    await context.request.post(`${base}/auth/login`, { form: { username: 'operator', password: 'meridian-fixture' }, maxRedirects: 0 });
    const page = await context.newPage();
    const decoder = await context.newPage();
    const profile = await meridianProfile();
    const tokens = createControlTokens('sess_console', createSequentialIds());
    const driver = createWebSurfaceDriver({ page, sessionId: 'sess_console', control: tokens, baseUrl: base });
    const surface = createGuardedSurface({
      driver,
      policy: { allowlist: allowlistFor(base), phase: 'replay', capabilityStatus: 'approved', allowUnattendedReplay: false, grants: createGrantLedger() },
      runId: 'run_000001',
      baseUrl: base,
    });
    const control = createSessionControl({ sessionId: 'sess_console', ids: createSequentialIds(), clock: systemClock, runId: 'run_000001', tokens });
    const token = control.apply('start').token;
    if (token === null) throw new Error('A started session was issued no token.');
    await surface.perform({ action: { kind: 'navigate', path: '/servicing', framePath: [] }, framePath: [], stepId: 'entry', effect: 'read', targetKey: null }, token);
    await surface.perform({ action: { kind: 'navigate', path: '/member/10001', framePath: ['content'] }, framePath: ['content'], stepId: 'entry', effect: 'read', targetKey: null }, token);

    const observation = await surface.observe();
    const [balanceRef] = matchStrategy(
      observation,
      { kind: 'anchor-relative', anchor: { kind: 'text', text: 'Savings', exact: true, confidence: 1 }, relation: 'rightOf', role: 'cell', confidence: 1 },
      ['content'],
    );
    if (balanceRef === undefined) throw new Error('The balance cell did not resolve.');
    const balanceBox = await page.locator(`aria-ref=${balanceRef}`).boundingBox();
    if (balanceBox === null) throw new Error('The balance cell has no box on the page.');

    const run = await createRunConsole({
      control,
      // Exactly what the three commands hand it, rather than a copy of the expression.
      screenshot: maskedScreenshot(surface, profile),
      redactor: createRedactor({ neverPersist: [], redactPatterns: [] }),
      known: [],
      clock: systemClock,
      ids: createSequentialIds(),
      claimTimeoutMs: 60_000,
      port: 0,
      announce: () => undefined,
      claimWindow: () => new Promise<void>(() => undefined),
    });

    try {
      // Over HTTP, from the endpoint the console page polls.
      const served = await fetch(`${run.baseUrl}/sessions/sess_console/screenshot`);
      expect(served.ok).toBe(true);
      const bytes = new Uint8Array(await served.arrayBuffer());

      const centre = [balanceBox.x + balanceBox.width / 2, balanceBox.y + balanceBox.height / 2] as const;
      expect(await pixelAt(decoder, bytes, centre[0], centre[1])).toEqual([255, 0, 255]);
    } finally {
      await run.close();
      await context.close();
    }
  });
});
