import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

// MERIDIAN Core, the local legacy fixture. See docs/TARGET_APP.md. It is deliberately
// not built like the code under test. Express, EJS, full page reloads, framesets and
// nested tables.

export interface TargetAppOptions {
  readonly username: string;
  readonly password: string;
  readonly testMode: boolean;
  readonly idSeed: string;
}

const Seed = z.strictObject({
  members: z.array(
    z.strictObject({
      id: z.string().regex(/^\d{5}$/),
      name: z.string().min(1),
      card: z.string().optional(),
      accounts: z.array(z.strictObject({ suffix: z.string(), type: z.string(), balance: z.string() })).min(1),
    }),
  ),
});

type Member = z.output<typeof Seed>['members'][number];

interface GeneratedField {
  readonly id: string;
  readonly name: string;
}

const SESSION_COOKIE = 'MERIDIAN_SID';

// Read again on every reset, so state changed by one test file cannot leak into the next.
function loadSeed(): readonly Member[] {
  return Seed.parse(JSON.parse(readFileSync(new URL('../seed.json', import.meta.url), 'utf8'))).members;
}

// Ids look like a WebForms page and derive from the process seed. An artifact that
// captured one breaks on the next restart, which is what a real generated id does.
function generatedField(seed: string, key: string): GeneratedField {
  const suffix = createHash('sha256').update(`${seed}:${key}`).digest('hex').slice(0, 5);
  return { id: `ctl00_cph_txt_${suffix}`, name: `ctl00$cph$txt_${suffix}` };
}

function sessionIdOf(req: Request): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === SESSION_COOKIE && value !== undefined) return value;
  }
  return null;
}

function formField(body: unknown, name: string): string {
  if (typeof body !== 'object' || body === null) return '';
  const value: unknown = Reflect.get(body, name);
  return typeof value === 'string' ? value : '';
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function surnameOf(member: Member): string {
  return member.name.split(' ').at(-1) ?? '';
}

export function createTargetApp(options: TargetAppOptions): Express {
  const app = express();
  const sessions = new Set<string>();
  let members = loadSeed();
  // Armed faults, scoped to a route and counted down, so a test arms exactly one surprise and
  // the app goes back to behaving itself afterwards.
  let faults: { readonly fault: string; readonly path: string; readonly method: string | null; remaining: number }[] = [];

  // A fault is scoped to a route, and to a method when one is named, because the same path is
  // served twice in this app and arming the wrong one spends the surprise before it matters.
  const consumeFault = (fault: string, path: string, method: string): boolean => {
    const armed = faults.find(
      (candidate) => candidate.fault === fault && candidate.path === path && (candidate.method === null || candidate.method === method) && candidate.remaining > 0,
    );
    if (armed === undefined) return false;
    armed.remaining -= 1;
    faults = faults.filter((candidate) => candidate.remaining > 0);
    return true;
  };

  // Responses the hang fault is holding open. A fault that can only be ended by a timeout
  // would make every suite that arms it wait, so reset releases them instead.
  let held: Response[] = [];
  const holdIfArmed = (path: string, method: string, res: Response): boolean => {
    if (!consumeFault('hang', path, method)) return false;
    held = [...held, res];
    return true;
  };

  // The label a locator reads to find the member ID field. Renaming it is the drift fault,
  // and the field behind it is untouched, so a bundle that does not depend on the label still
  // resolves and a bundle that does has to fall back.
  const labelForMemberId = (method: string): string => (consumeFault('relabel', '/servicing/search', method) ? 'Account Holder  ID:' : 'Member  ID:');

  const fields = {
    memberId: generatedField(options.idSeed, 'memberId'),
    surname: generatedField(options.idSeed, 'surname'),
  };

  // The write flow. Opening a sub account is the only thing in this app that changes anything,
  // which is why the app profile classifies its POST as a write.
  const subaccountFields = {
    accountType: generatedField(options.idSeed, 'accountType'),
    openingAmount: generatedField(options.idSeed, 'openingAmount'),
  };
  const accountTypes = ['Savings', 'Checking', 'Holiday Club'];
  const minimumOpening = 25;
  const submissions: { memberId: string; accountType: string; suffix: string; balance: string }[] = [];

  const nextSuffix = (member: Member, type: string): string => {
    const letter = (type[0] ?? 'S').toUpperCase();
    return `${letter}${String(member.accounts.filter((account) => account.suffix.startsWith(letter)).length + 1).padStart(2, '0')}`;
  };

  const hasSession = (req: Request): boolean => {
    const id = sessionIdOf(req);
    return id !== null && sessions.has(id);
  };

  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('../views', import.meta.url)));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Test mode only. Every request served outside the control routes, so a test can prove
  // a request the network guard refused never reached the app.
  const requests: { method: string; path: string }[] = [];
  if (options.testMode) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (!req.path.startsWith('/__control__')) requests.push({ method: req.method, path: req.path });
      next();
    });
  }

  app.get('/', (req, res) => {
    res.redirect(hasSession(req) ? '/servicing' : '/auth/login');
  });

  app.get('/auth/login', (_req, res) => {
    res.render('login', { error: null });
  });

  app.post('/auth/login', (req, res) => {
    if (formField(req.body, 'username') !== options.username || formField(req.body, 'password') !== options.password) {
      res.render('login', { error: 'Invalid user name or password.' });
      return;
    }
    const id = randomBytes(16).toString('hex');
    sessions.add(id);
    res.cookie(SESSION_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' });
    res.redirect('/servicing');
  });

  if (options.testMode) {
    // Mounted only in test mode and denied by the allowlist, so automation cannot reach
    // its own fault injection. Sessions survive a reset, so a leased browser stays signed in.
    app.get('/__control__/reset', (_req, res) => {
      members = loadSeed();
      faults = [];
      requests.length = 0;
      submissions.length = 0;
      // Anything the hang fault is holding is answered now, with the status a surface that
      // gave up would send, so the caller gets a result rather than a dead socket.
      for (const holding of held) if (!holding.headersSent) holding.status(503).render('unavailable');
      held = [];
      res.json({ reset: true });
    });
    app.get('/__control__/state', (_req, res) => {
      res.json({ faults, sessions: sessions.size, requests, submissions });
    });
    // Arms one fault on one route, for a number of responses. Nothing here is reachable by the
    // automation, because the allowlist denies /__control__ outright.
    app.post('/__control__/fault', (req, res) => {
      const fault = formField(req.body, 'fault');
      const path = formField(req.body, 'path');
      const method = formField(req.body, 'method');
      const count: unknown = typeof req.body === 'object' && req.body !== null ? Reflect.get(req.body, 'count') : undefined;
      if (fault === '' || path === '') {
        res.status(400).json({ error: 'A fault and a path are required.' });
        return;
      }
      const armed = { fault, path, method: method === '' ? null : method.toUpperCase(), remaining: typeof count === 'number' && count > 0 ? count : 1 };
      faults = [...faults, armed];
      res.json({ armed });
    });
  }

  app.use(['/servicing', '/member'], (req: Request, res: Response, next: NextFunction) => {
    if (hasSession(req)) {
      next();
      return;
    }
    res.redirect('/auth/login');
  });

  app.get('/servicing', (_req, res) => {
    res.render('servicing');
  });
  app.get('/servicing/nav', (_req, res) => {
    res.render('nav');
  });
  app.get('/servicing/status', (_req, res) => {
    res.render('status');
  });

  app.get('/servicing/search', (_req, res) => {
    res.render('search', {
      fields,
      values: { memberId: '', surname: '' },
      results: [],
      message: null,
      dialog: consumeFault('surpriseDialog', '/servicing/search', 'GET'),
      memberIdLabel: labelForMemberId('GET'),
    });
  });

  app.post('/servicing/search', (req, res) => {
    const values = {
      memberId: formField(req.body, fields.memberId.name).trim(),
      surname: formField(req.body, fields.surname.name).trim(),
    };
    const dialog = consumeFault('surpriseDialog', '/servicing/search', 'POST');
    const memberIdLabel = labelForMemberId('POST');
    if (values.memberId === '' && values.surname === '') {
      res.render('search', { fields, values, results: [], message: 'Enter a member ID or surname.', dialog, memberIdLabel });
      return;
    }
    const found = members.filter((member) =>
      values.memberId !== '' ? member.id === values.memberId : surnameOf(member).toLowerCase() === values.surname.toLowerCase(),
    );
    // Two rows showing the same member ID and linking to different records, which is what a
    // locator that matches on the displayed text cannot tell apart.
    const results = found.length > 0 && consumeFault('duplicateIds', '/servicing/search', 'POST') ? [...found, { ...(found[0] as Member), id: found[0]?.id ?? '' }] : found;
    res.render('search', { fields, values, results, message: results.length === 0 ? 'No records found.' : null, dialog, memberIdLabel });
  });

  app.get('/member/:id/subaccount', (req, res) => {
    const member = members.find((candidate) => candidate.id === req.params.id);
    if (member === undefined) {
      res.status(404).render('notFound');
      return;
    }
    res.render('subaccount', { member, fields: subaccountFields, types: accountTypes, values: { accountType: '', openingAmount: '' }, error: null });
  });

  app.post('/member/:id/subaccount', (req, res) => {
    const member = members.find((candidate) => candidate.id === req.params.id);
    if (member === undefined) {
      res.status(404).render('notFound');
      return;
    }

    // Armed against the wildcard route, because the real path carries a member id. The 503
    // happens before anything is opened, so a run that retried it would open two accounts.
    if (consumeFault('flaky503', '/member/*/subaccount', 'POST')) {
      res.status(503).render('unavailable');
      return;
    }

    const values = {
      accountType: formField(req.body, subaccountFields.accountType.name).trim(),
      openingAmount: formField(req.body, subaccountFields.openingAmount.name).trim(),
    };
    const amount = Number(values.openingAmount.replace(/[$,\s]/g, ''));
    const error =
      values.accountType === ''
        ? 'Choose an account type.'
        : !Number.isFinite(amount) || amount < minimumOpening
          ? `The opening amount must be at least ${formatMoney(minimumOpening)}.`
          : null;
    if (error !== null) {
      res.render('subaccount', { member, fields: subaccountFields, types: accountTypes, values, error });
      return;
    }

    const suffix = nextSuffix(member, values.accountType);
    const balance = formatMoney(amount);
    members = members.map((candidate) =>
      candidate.id === member.id ? { ...candidate, accounts: [...candidate.accounts, { suffix, type: values.accountType, balance }] } : candidate,
    );
    submissions.push({ memberId: member.id, accountType: values.accountType, suffix, balance });
    res.render('subaccountConfirmed', { member, suffix, accountType: values.accountType, balance });
  });

  app.get('/member/:id', (req, res) => {
    // Held before the record is looked up, because a surface that never answers never gets as
    // far as deciding what it would have said.
    if (holdIfArmed('/member/*', 'GET', res)) return;

    const member = members.find((candidate) => candidate.id === req.params.id);
    if (member === undefined) {
      res.status(404).render('notFound');
      return;
    }
    // A restriction is an answer the institution gave, not a fault of ours, so it renders as an
    // ordinary page with a message and no record on it.
    if (consumeFault('denied', '/member/*', 'GET')) {
      res.render('restricted', { memberId: member.id });
      return;
    }
    res.render('member', { member });
  });

  return app;
}
