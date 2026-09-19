import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSessionControl, type SessionControl } from '../../src/control/controlPlane.js';
import { createControlTokens } from '../../src/control/controlToken.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import type { Handover } from '../../src/escalation/channel.js';
import type { HumanActionRecord, HumanInputPort, HumanNavigation } from '../../src/escalation/humanInput.js';
import { createRunConsole, type RunConsole } from '../../src/escalation/runConsole.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';

// The one page a person actually uses, driven the way they drive it. Everything under it is
// covered headlessly elsewhere, and that is exactly why this file has to exist. An operator API
// test that posts to /sessions/:id/input proves the endpoint works and says nothing about
// whether the page ever calls it. It did not, and nothing caught that until a live run.
//
// So every assertion here goes through the page. A click on the picture, a keystroke, a frame
// sent to a path, and the two ways of handing the session back.

const SHOT = { width: 400, height: 300 };

interface Forwarded {
  readonly kind: string;
  readonly x?: number;
  readonly y?: number;
  readonly key?: string;
  readonly path?: string;
  readonly framePath?: string;
}

describe('the operator console page', { timeout: 60_000 }, () => {
  let browser: Browser;
  let page: Page;
  let run: RunConsole | null = null;
  let forwarded: Forwarded[] = [];
  let screenshot: Buffer;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    // A real screenshot of a known size, so the page's mapping from where a person clicked on
    // the picture back into page space is checked against real numbers.
    const source = await browser.newPage();
    await source.setViewportSize(SHOT);
    await source.setContent('<body style="margin:0;background:#ece9d8"></body>');
    screenshot = await source.screenshot();
    await source.close();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  afterEach(async () => {
    await run?.close();
    run = null;
  });

  const record = (kind: HumanActionRecord['kind'], extra: Partial<HumanActionRecord> = {}): HumanActionRecord => ({
    at: '2026-09-18T09:00:00.000Z',
    kind,
    target: null,
    url: 'http://localhost:4010/servicing',
    ...extra,
  });

  const input: HumanInputPort = {
    click: async ({ x, y }) => {
      forwarded.push({ kind: 'click', x, y });
      return record('click');
    },
    press: async (key) => {
      forwarded.push({ kind: 'press', key });
      return record('press', { key });
    },
    navigate: async ({ path, framePath }): Promise<HumanNavigation> => {
      forwarded.push({ kind: 'navigate', path, framePath: framePath.join('/') });
      if (path.startsWith('/admin')) return { ok: false, reason: 'notAllowed', detail: 'The path is denied by the allowlist.' };
      return { ok: true, record: record('navigate', { path, framePath: [...framePath] }) };
    },
  };

  async function stopFor(reason: 'PolicyConfirmation' | 'UnclassifiedCondition'): Promise<{ control: SessionControl; handover: Promise<Handover> }> {
    forwarded = [];
    const tokens = createControlTokens('sess_000001', createSequentialIds());
    const control = createSessionControl({ sessionId: 'sess_000001', ids: createSequentialIds(), clock: systemClock, runId: 'run_000001', tokens });
    control.apply('start');
    const opened = await createRunConsole({
      control,
      screenshot: async () => new Uint8Array(screenshot),
      input,
      redactor: createRedactor({ neverPersist: [], redactPatterns: [] }),
      known: [],
      clock: systemClock,
      ids: createSequentialIds(),
      claimTimeoutMs: 60_000,
      port: 0,
      announce: () => undefined,
      claimWindow: () => new Promise<void>(() => undefined),
      subject: () => ({ memberId: '10001', accountType: 'Holiday Club' }),
    });
    run = opened;

    const handover = opened.escalation.raise({
      sessionId: 'sess_000001',
      runId: 'run_000001',
      phase: 'discovery',
      reason,
      explanation: 'This step opens a sub account on the system of record.',
      suggestedAction: 'Check the screen, then approve it or refuse it.',
      goal: 'open a sub account for {{inputs.memberId}}',
      url: 'http://localhost:4010/servicing',
      framePath: [],
      screenshotRef: 'captures/intervention-01.png',
      snapshotRef: 'captures/intervention-01.a11y.json',
      recentActions: [],
    });
    await page.goto(opened.baseUrl);
    await page.locator('#status:has-text("Claim the session")').waitFor();
    // The picture is on screen before anybody clicks on it.
    await page.waitForFunction('document.getElementById("canvas").width === 400');
    return { control, handover };
  }

  it('shows a claimed operator which record the change is for, which is what approving means', async () => {
    const { handover } = await stopFor('PolicyConfirmation');

    // Before claiming, the panel says nothing about the subject. Looking is not authorising.
    expect(await page.locator('#subject').innerText()).not.toContain('10001');

    await page.click('#claim');
    await page.locator('#subject:has-text("10001")').waitFor();

    // A sufficiency check rather than a masking one. The screen masks the member number and
    // the trace holds a template, so before this the only place the value existed was the
    // command the operator typed. Approving a write without being able to say who it is for
    // is not approval.
    const shown = await page.locator('#subject').innerText();
    expect(shown).toContain('memberId');
    expect(shown).toContain('10001');
    void handover;
  });

  it('turns a click on the picture into a click on the live session, in page space', async () => {
    const { handover } = await stopFor('UnclassifiedCondition');
    await page.click('#claim');

    // The middle of the shown picture, whatever size the console is drawing it at.
    const box = await page.locator('#canvas').boundingBox();
    if (box === null) throw new Error('The console is not showing a screen.');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('#status:has-text("Sent")').waitFor();

    const click = forwarded.find((entry) => entry.kind === 'click');
    expect(click?.x).toBeGreaterThan(SHOT.width / 2 - 3);
    expect(click?.x).toBeLessThan(SHOT.width / 2 + 3);
    expect(click?.y).toBeGreaterThan(SHOT.height / 2 - 3);
    expect(click?.y).toBeLessThan(SHOT.height / 2 + 3);
    void handover;
  });

  it('types into the live session, one keystroke at a time', async () => {
    const { handover } = await stopFor('UnclassifiedCondition');
    await page.click('#claim');
    await page.click('#canvas');

    await page.keyboard.type('10001');
    await page.keyboard.press('Enter');

    // The console sends one at a time and in order, so the assertion waits for the queue to
    // drain rather than for a status line that appears after the first one.
    await expect.poll(() => forwarded.filter((entry) => entry.kind === 'press').length).toBe(6);
    expect(forwarded.filter((entry) => entry.kind === 'press').map((entry) => entry.key)).toEqual(['1', '0', '0', '0', '1', 'Enter']);
    void handover;
  });

  it('sends a frame to a path, which is the only way a person reaches a page nothing links to', async () => {
    const { handover } = await stopFor('UnclassifiedCondition');
    await page.click('#claim');

    await page.fill('#path', '/member/10001/subaccount');
    await page.click('#go');
    await page.locator('#status:has-text("moved")').waitFor();

    expect(forwarded).toContainEqual({ kind: 'navigate', path: '/member/10001/subaccount', framePath: 'content' });
    void handover;
  });

  it('says why a refused navigation did not happen, rather than doing nothing', async () => {
    const { handover } = await stopFor('UnclassifiedCondition');
    await page.click('#claim');

    await page.fill('#path', '/admin/users');
    await page.click('#go');

    await page.locator('#status:has-text("refused")').waitFor();
    void handover;
  });

  it('touches nothing before the session has been claimed', async () => {
    const { handover } = await stopFor('UnclassifiedCondition');

    const box = await page.locator('#canvas').boundingBox();
    if (box === null) throw new Error('The console is not showing a screen.');
    await page.mouse.click(box.x + 10, box.y + 10);
    await page.keyboard.type('x');
    await page.locator('#status:has-text("Claim the session before")').waitFor();

    expect(forwarded).toEqual([]);
    expect(await page.locator('#go').isDisabled()).toBe(true);
    void handover;
  });

  it('offers approval only when the run is asking for it, and sends it when the person clicks it', async () => {
    const { handover } = await stopFor('PolicyConfirmation');

    expect(await page.locator('#approve').isVisible()).toBe(true);
    await page.click('#claim');
    await page.click('#approve');

    const settled = await handover;
    expect(settled.kind).toBe('resumed');
    if (settled.kind !== 'resumed') return;
    expect(settled.approved).toBe(true);
  });

  it('hands the session back without approving anything when the person only releases it', async () => {
    const { handover } = await stopFor('PolicyConfirmation');

    await page.click('#claim');
    await page.click('#release');

    const settled = await handover;
    if (settled.kind !== 'resumed') throw new Error('The release did not resume the run.');
    expect(settled.approved).toBe(false);
  });

  it('never shows an approval when nobody asked for one', async () => {
    const { handover } = await stopFor('UnclassifiedCondition');

    expect(await page.locator('#approve').isVisible()).toBe(false);
    await page.click('#claim');
    await page.click('#release');

    expect((await handover).kind).toBe('resumed');
  });
});
