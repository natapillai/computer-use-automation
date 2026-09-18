import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';

// The write flow at the app, before any automation touches it. Opening a sub account is the one
// thing in MERIDIAN Core that changes state, so its validation, its confirmation and its failure
// mode are pinned here.

describe('opening a sub account', () => {
  let server: Server;
  let base = '';
  let cookie = '';
  let fields: { accountType: string; openingAmount: string };

  async function post(path: string, form: Record<string, string>): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      redirect: 'manual',
    });
  }

  beforeAll(async () => {
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: true, idSeed: 'subaccount' });
    server = await new Promise<Server>((listening) => {
      const bound = app.listen(0, '127.0.0.1', () => listening(bound));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;

    const signedIn = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'operator', password: 'meridian-fixture' }).toString(),
      redirect: 'manual',
    });
    cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).toContain('MERIDIAN_SID');

    // The field names are generated per process, exactly as a WebForms page would.
    const form = await fetch(`${base}/member/10001/subaccount`, { headers: { cookie } }).then((response) => response.text());
    const names = [...form.matchAll(/name="(ctl00\$cph\$txt_[0-9a-f]+)"/g)].map((match) => match[1] ?? '');
    const [accountType, openingAmount] = names;
    if (accountType === undefined || openingAmount === undefined) throw new Error('The sub account form has no generated fields.');
    fields = { accountType, openingAmount };
  });

  afterAll(async () => {
    await new Promise<void>((closed) => server.close(() => closed()));
  });

  it('serves the form for a member and refuses an unknown one', async () => {
    const form = await fetch(`${base}/member/10001/subaccount`, { headers: { cookie } });
    const missing = await fetch(`${base}/member/00000/subaccount`, { headers: { cookie } });

    expect(form.status).toBe(200);
    expect(await form.text()).toContain('Open Sub Account');
    expect(missing.status).toBe(404);
  });

  it('refuses an opening amount below the minimum and says so on the form', async () => {
    const answered = await post('/member/10001/subaccount', { [fields.accountType]: 'Savings', [fields.openingAmount]: '5.00' });

    const body = await answered.text();
    expect(answered.status).toBe(200);
    expect(body).toContain('The opening amount must be at least $25.00.');

    const state = await fetch(`${base}/__control__/state`).then((response) => response.json());
    expect(Reflect.get(state as object, 'submissions')).toEqual([]);
  });

  it('opens the account, confirms it, and shows it on the member', async () => {
    const opened = await post('/member/10001/subaccount', { [fields.accountType]: 'Holiday Club', [fields.openingAmount]: '250.00' });

    const body = await opened.text();
    expect(body).toContain('Sub Account Opened');
    expect(body).toContain('H01');
    expect(body).toContain('$250.00');

    const member = await fetch(`${base}/member/10001`, { headers: { cookie } }).then((response) => response.text());
    expect(member).toContain('Holiday Club');

    const state = await fetch(`${base}/__control__/state`).then((response) => response.json());
    expect(Reflect.get(state as object, 'submissions')).toEqual([{ memberId: '10001', accountType: 'Holiday Club', suffix: 'H01', balance: '$250.00' }]);
  });

  it('answers an armed flaky503 with Service Unavailable and opens nothing', async () => {
    await fetch(`${base}/__control__/reset`);
    await fetch(`${base}/__control__/fault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault: 'flaky503', path: '/member/*/subaccount', method: 'POST', count: 1 }),
    });

    const refused = await post('/member/10001/subaccount', { [fields.accountType]: 'Savings', [fields.openingAmount]: '250.00' });

    expect(refused.status).toBe(503);
    expect(await refused.text()).toContain('Service Unavailable');
    const state = await fetch(`${base}/__control__/state`).then((response) => response.json());
    expect(Reflect.get(state as object, 'submissions')).toEqual([]);

    // Armed once, so the next attempt is served normally.
    const opened = await post('/member/10001/subaccount', { [fields.accountType]: 'Savings', [fields.openingAmount]: '250.00' });
    expect(await opened.text()).toContain('Sub Account Opened');
  });
});
