import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createControlTokens } from '../../src/control/controlToken.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { createWebSurfaceDriver } from '../../src/surface/web/webSurfaceDriver.js';
import { surfaceDriverContract } from '../contract/surfaceDriver.contract.js';

// The same contract the fake passes, run against the live app. One browser for the file
// and a fresh signed in context for each test.
let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed: 'contract' });
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

surfaceDriverContract('web', async () => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  await context.request.post(`${base}/auth/login`, { form: { username: 'operator', password: 'meridian-fixture' }, maxRedirects: 0 });
  const page = await context.newPage();
  const tokens = createControlTokens('sess_contract', createSequentialIds());
  return {
    driver: createWebSurfaceDriver({ page, sessionId: 'sess_contract', control: tokens, baseUrl: base }),
    tokens,
    close: () => context.close(),
  };
});
