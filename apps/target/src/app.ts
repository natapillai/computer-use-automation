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

function surnameOf(member: Member): string {
  return member.name.split(' ').at(-1) ?? '';
}

export function createTargetApp(options: TargetAppOptions): Express {
  const app = express();
  const sessions = new Set<string>();
  let members = loadSeed();
  let faults: readonly string[] = [];

  const fields = {
    memberId: generatedField(options.idSeed, 'memberId'),
    surname: generatedField(options.idSeed, 'surname'),
  };

  const hasSession = (req: Request): boolean => {
    const id = sessionIdOf(req);
    return id !== null && sessions.has(id);
  };

  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('../views', import.meta.url)));
  app.use(express.urlencoded({ extended: false }));

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
      res.json({ reset: true });
    });
    app.get('/__control__/state', (_req, res) => {
      res.json({ faults, sessions: sessions.size });
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
    res.render('search', { fields, values: { memberId: '', surname: '' }, results: [], message: null });
  });

  app.post('/servicing/search', (req, res) => {
    const values = {
      memberId: formField(req.body, fields.memberId.name).trim(),
      surname: formField(req.body, fields.surname.name).trim(),
    };
    if (values.memberId === '' && values.surname === '') {
      res.render('search', { fields, values, results: [], message: 'Enter a member ID or surname.' });
      return;
    }
    const results = members.filter((member) =>
      values.memberId !== '' ? member.id === values.memberId : surnameOf(member).toLowerCase() === values.surname.toLowerCase(),
    );
    res.render('search', { fields, values, results, message: results.length === 0 ? 'No records found.' : null });
  });

  app.get('/member/:id', (req, res) => {
    const member = members.find((candidate) => candidate.id === req.params.id);
    if (member === undefined) {
      res.status(404).render('notFound');
      return;
    }
    res.render('member', { member });
  });

  return app;
}
