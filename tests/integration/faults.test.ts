import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';

// S6-T01. The four faults the target app still owed, each asserted against the row that
// describes it in docs/TARGET_APP.md section 5. Every fault is scoped to a route and counted
// down, so arming one is a single surprise rather than a mode the app stays in.
//
// What each fault is for lives in the replay matrix at S6-T04. This file only proves the
// application behaves the way the table says, because a fault that does not fire is a test
// that passes for the wrong reason.

const credentials = { username: 'operator', password: 'meridian-fixture' };

describe('the injectable faults', { timeout: 30_000 }, () => {
  let server: Server;
  let base = '';
  let cookie = '';

  beforeAll(async () => {
    const app = createTargetApp({ ...credentials, testMode: true, idSeed: 'faults' });
    server = await new Promise<Server>((listening) => {
      const bound = app.listen(0, '127.0.0.1', () => listening(bound));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;

    const signedIn = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(credentials).toString(),
      redirect: 'manual',
    });
    cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).toContain('MERIDIAN_SID');
  });

  afterAll(async () => {
    await new Promise<void>((closed) => server.close(() => closed()));
  });

  beforeEach(async () => {
    await fetch(`${base}/__control__/reset`);
  });

  async function arm(fault: string, path: string, method: string | null, count = 1): Promise<void> {
    const armed = await fetch(`${base}/__control__/fault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault, path, ...(method === null ? {} : { method }), count }),
    });
    expect(armed.status).toBe(200);
  }

  const page = async (path: string): Promise<string> => (await fetch(`${base}${path}`, { headers: { cookie } })).text();

  async function search(memberId: string): Promise<string> {
    const form = await page('/servicing/search');
    const field = /name="(ctl00\$cph\$txt_[0-9a-f]{5})"/.exec(form)?.[1];
    if (field === undefined) throw new Error('The search form has no generated member ID field.');
    const answered = await fetch(`${base}/servicing/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ [field]: memberId }).toString(),
    });
    expect(answered.status).toBe(200);
    return answered.text();
  }

  it('denied shows a restriction panel on member detail instead of the record', async () => {
    await arm('denied', '/member/*', 'GET');

    const restricted = await page('/member/10001');

    expect(restricted).toContain('Access to this record is restricted');
    // The record itself is not on the page, which is what makes this a business outcome
    // rather than a page that merely looks different.
    expect(restricted).not.toContain('Savings');
    expect(restricted).not.toContain('Test Member One');

    // Armed once, so the next read is the ordinary record.
    expect(await page('/member/10001')).toContain('Savings');
  });

  it('relabel renames the member ID field so a locator that reads the label has to drift', async () => {
    await arm('relabel', '/servicing/search', null);

    const renamed = await page('/servicing/search');

    expect(renamed).toContain('Account Holder  ID:');
    expect(renamed).not.toContain('Member  ID:');
    // The field itself is untouched, so a locator that does not depend on the label still
    // resolves. That is the whole point of the fault.
    expect(/name="(ctl00\$cph\$txt_[0-9a-f]{5})"/.test(renamed)).toBe(true);

    expect(await page('/servicing/search')).toContain('Member  ID:');
  });

  it('duplicateIds returns two rows showing the same member ID', async () => {
    await arm('duplicateIds', '/servicing/search', 'POST');

    const results = await search('10001');

    const rows = [...results.matchAll(/<a href="\/member\/[0-9]+">10001<\/a>/g)];
    expect(rows).toHaveLength(2);

    // Armed once, so an ordinary search resolves to one row again.
    expect([...(await search('10001')).matchAll(/<a href="\/member\/[0-9]+">10001<\/a>/g)]).toHaveLength(1);
  });

  it('hang never answers, and reset releases the held response', async () => {
    await arm('hang', '/member/*', 'GET');

    const held = fetch(`${base}/member/10001`, { headers: { cookie } });
    let answered = false;
    void held.then(() => {
      answered = true;
    });
    // Nothing waits on a clock here. A request that has not resolved by the time several
    // rounds of the event loop have passed is being held, which is what the fault promises.
    for (let round = 0; round < 20; round += 1) await Promise.resolve();
    expect(answered).toBe(false);

    await fetch(`${base}/__control__/reset`);

    // The held response is released by reset rather than left to time out, so a suite never
    // waits on a socket it armed itself.
    expect((await held).status).toBe(503);
  });
});
