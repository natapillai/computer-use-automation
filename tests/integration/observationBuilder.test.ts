import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createControlTokens, type ControlToken } from '../../src/control/controlToken.js';
import type { LocatorStrategy } from '../../src/core/locator/schema.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import { Cassette, lineDiff, type CassetteFile } from '../../src/discovery/cassetteModelClient.js';
import { buildObservation, type ObservationContext } from '../../src/discovery/observation.js';
import { loadAllowlist } from '../../src/runtime/allowlist.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import type { SurfaceDriver } from '../../src/surface/types.js';
import { createWebSurfaceDriver } from '../../src/surface/web/webSurfaceDriver.js';
import { meridianProfile } from '../fixtures/profile.js';

// The committed S2-T01 cassette can drive the loop only while the observation builder shows
// the model exactly what the spike showed it. This walks the live app through the spike's
// four actions and asserts every observation hashes to the recorded one, which also checks
// ADR 0017's claim that refs are stable across runs.
describe('the observation builder against the S2-T01 recording', { timeout: 60_000 }, () => {
  let server: Server;
  let base: string;
  let browser: Browser;
  let cassette: CassetteFile;
  let context: ObservationContext;

  beforeAll(async () => {
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed: 'observation-builder' });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
    cassette = Cassette.parse(JSON.parse(await readFile('tests/fixtures/cassettes/discovery.readSavingsBalance.json', 'utf8')));
    const allowlist = await loadAllowlist('policy/allowlist.yaml');
    if (!allowlist.ok) throw new Error(allowlist.message);
    context = { profile: await meridianProfile(), redactor: createRedactor(allowlist.allowlist.data), inputs: { memberId: '10001' } };
  }, 30_000);

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function refFor(driver: SurfaceDriver, strategy: LocatorStrategy): Promise<string> {
    const [ref] = await driver.match(strategy, ['content']);
    if (ref === undefined) throw new Error(`Nothing matched ${JSON.stringify(strategy)}.`);
    return ref;
  }

  async function landed(page: Page, act: () => Promise<unknown>): Promise<void> {
    const navigated = page.waitForEvent('framenavigated', (frame: Frame) => frame.name() === 'content');
    await act();
    const frame = await navigated;
    await frame.waitForLoadState('load');
  }

  it('reproduces the recorded observation hash after entry, fill, search and opening the member', async () => {
    const browserContext = await browser.newContext({ viewport: { width: 1024, height: 700 } });
    await browserContext.request.post(`${base}/auth/login`, { form: { username: 'operator', password: 'meridian-fixture' }, maxRedirects: 0 });
    const page = await browserContext.newPage();
    const tokens = createControlTokens('sess_builder', createSequentialIds());
    const driver = createWebSurfaceDriver({ page, sessionId: 'sess_builder', control: tokens, baseUrl: base });
    const token: ControlToken = tokens.issue('automation');

    const hashes: string[] = [];
    const texts: string[] = [];
    const record = async () => {
      const built = buildObservation(await driver.observe(), context);
      hashes.push(built.hash);
      texts.push(built.text);
    };

    await driver.act({ kind: 'navigate', path: '/servicing', framePath: [] }, token);
    await record();

    const field = await refFor(driver, { kind: 'anchor-relative', anchor: { kind: 'text', text: 'Member ID:', exact: false, confidence: 1 }, relation: 'sameRow', role: 'textbox', confidence: 1 });
    await driver.act({ kind: 'fill', ref: field, value: '10001' }, token);
    await record();

    const search = await refFor(driver, { kind: 'role-name', role: 'cell', name: 'Search', exact: true, confidence: 1 });
    await landed(page, () => driver.act({ kind: 'click', ref: search }, token));
    await record();

    const link = await refFor(driver, { kind: 'role-name', role: 'link', name: '10001', exact: true, confidence: 1 });
    await landed(page, () => driver.act({ kind: 'click', ref: link }, token));
    await record();

    const recorded = cassette.exchanges.slice(0, 4);
    const explained = recorded.map((exchange, i) => (exchange.observationHash === hashes[i] ? 'same' : lineDiff(exchange.observationText, texts[i] ?? '')));
    expect(explained).toEqual(['same', 'same', 'same', 'same']);

    await browserContext.close();
  });
});
