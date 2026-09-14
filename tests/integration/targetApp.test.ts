import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp, type TargetAppOptions } from '../../apps/target/src/app.js';

interface Running {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const credentials = { username: 'operator', password: 'meridian-fixture' };

async function start(overrides: Partial<TargetAppOptions> = {}): Promise<Running> {
  const app = createTargetApp({ ...credentials, testMode: false, idSeed: 'seed-a', ...overrides });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function login(baseUrl: string, password = credentials.password): Promise<Response> {
  return fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: credentials.username, password }).toString(),
    redirect: 'manual',
  });
}

async function sessionCookie(baseUrl: string): Promise<string> {
  const [cookie] = (await login(baseUrl)).headers.getSetCookie();
  if (cookie === undefined) throw new Error('Login set no cookie.');
  return cookie.split(';')[0] ?? '';
}

async function get(baseUrl: string, path: string, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: cookie === undefined ? {} : { cookie }, redirect: 'manual' });
}

async function searchFor(baseUrl: string, cookie: string, memberId: string): Promise<string> {
  const form = await (await get(baseUrl, '/servicing/search', cookie)).text();
  const fieldName = /name="(ctl00\$cph\$txt_[0-9a-f]{5})"/.exec(form)?.[1];
  if (fieldName === undefined) throw new Error('The search form has no generated member ID field.');
  const response = await fetch(`${baseUrl}/servicing/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ [fieldName]: memberId }).toString(),
  });
  expect(response.status).toBe(200);
  return response.text();
}

describe('MERIDIAN Core', () => {
  let target: Running;
  let cookie: string;

  beforeAll(async () => {
    target = await start();
    cookie = await sessionCookie(target.baseUrl);
  });
  afterAll(() => target.close());

  it('redirects every unauthenticated request to the login page', async () => {
    for (const path of ['/', '/servicing', '/servicing/search', '/servicing/nav', '/member/10001']) {
      const response = await get(target.baseUrl, path);
      expect(response.status, path).toBe(302);
      expect(response.headers.get('location'), path).toBe('/auth/login');
    }
  });

  it('refuses wrong credentials without setting a session', async () => {
    const response = await login(target.baseUrl, 'wrong');

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).toContain('Invalid user name or password.');
  });

  it('serves the login page, the frameset and every frame', async () => {
    expect((await get(target.baseUrl, '/auth/login')).status).toBe(200);
    expect((await get(target.baseUrl, '/', cookie)).headers.get('location')).toBe('/servicing');

    const shell = await get(target.baseUrl, '/servicing', cookie);
    expect(shell.status).toBe(200);
    const html = await shell.text();
    for (const frame of ['status', 'nav', 'content']) expect(html).toMatch(new RegExp(`<frame name="${frame}" src="/servicing/`));

    for (const path of ['/servicing/nav', '/servicing/status', '/servicing/search']) {
      expect((await get(target.baseUrl, path, cookie)).status, path).toBe(200);
    }
  });

  it('keeps both hostile controls and carries no test ids', async () => {
    const html = await (await get(target.baseUrl, '/servicing/search', cookie)).text();

    expect(html).toMatch(/<td class="lbl">Member {2}ID:<\/td>\s*<td><input type="text" id="ctl00_cph_txt_[0-9a-f]{5}"/);
    expect(html).toMatch(/<td class="btn" onclick="[^"]+">Search<\/td>/);
    expect(html).not.toMatch(/<label|<button|data-testid|title=/);
  });

  it('returns a result row linked by the member id for a known member', async () => {
    const html = await searchFor(target.baseUrl, cookie, '10001');

    expect(html).toContain('<a href="/member/10001">10001</a>');
    expect(html).toContain('Test Member One');
    expect(html).not.toContain('No records found');
  });

  it('returns the no records banner for 00000', async () => {
    const html = await searchFor(target.baseUrl, cookie, '00000');

    expect(html).toContain('No records found');
    expect(html).not.toContain('<a href="/member/');
  });

  it('renders each seeded balance format in the cell right of Savings', async () => {
    for (const [memberId, balance] of [
      ['10001', '$4,250.75'],
      ['10002', '1980.40 USD'],
      ['10003', '(125.00)'],
      ['10004', '$0.00'],
    ] as const) {
      const response = await get(target.baseUrl, `/member/${memberId}`, cookie);
      expect(response.status, memberId).toBe(200);
      const html = await response.text();
      const escaped = balance.replace(/[$()]/g, '\\$&');
      expect(html, memberId).toMatch(new RegExp(`<td>Savings</td>\\s*<td class="amt">${escaped}</td>`));
    }
  });

  it('shows the canary card on 10001 and four account rows on 10003', async () => {
    expect(await (await get(target.baseUrl, '/member/10001', cookie)).text()).toContain('4111 1111 1111 1111');
    expect((await (await get(target.baseUrl, '/member/10003', cookie)).text()).match(/<td class="amt">/g)).toHaveLength(4);
  });

  it('answers 404 for a member that does not exist', async () => {
    expect((await get(target.baseUrl, '/member/00000', cookie)).status).toBe(404);
  });

  it('does not mount the control routes without test mode', async () => {
    for (const path of ['/__control__/reset', '/__control__/state']) {
      expect((await get(target.baseUrl, path)).status, path).toBe(404);
    }
  });
});

describe('MERIDIAN Core in test mode', () => {
  it('mounts reset and state', async () => {
    const target = await start({ testMode: true });
    try {
      expect((await get(target.baseUrl, '/__control__/reset')).status).toBe(200);
      const state = await get(target.baseUrl, '/__control__/state');
      expect(state.status).toBe(200);
      expect(await state.json()).toMatchObject({ faults: [] });
    } finally {
      await target.close();
    }
  });
});

describe('generated element ids', () => {
  it('are stable for one seed and change with the seed', async () => {
    const pages: string[] = [];
    for (const idSeed of ['seed-a', 'seed-a', 'seed-b']) {
      const target = await start({ idSeed });
      try {
        pages.push(await (await get(target.baseUrl, '/servicing/search', await sessionCookie(target.baseUrl))).text());
      } finally {
        await target.close();
      }
    }

    expect(pages[0]).toBe(pages[1]);
    expect(pages[0]).not.toBe(pages[2]);
  });
});
