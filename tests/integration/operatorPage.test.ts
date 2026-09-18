import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSessionControl, type SessionControl } from '../../src/control/controlPlane.js';
import { createControlTokens } from '../../src/control/controlToken.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import type { Handover } from '../../src/escalation/channel.js';
import { createRunConsole, type RunConsole } from '../../src/escalation/runConsole.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';

// The one page a person actually uses. Everything under it is driven headlessly elsewhere, so
// what this covers is the part no API test can reach, which is what each button sends.
//
// Approving is the button that matters. A run stopped for a write is asking one question, and
// a console that answers it by accident, in either direction, is worse than no console.

describe('the operator console page', { timeout: 60_000 }, () => {
  let browser: Browser;
  let page: Page;
  let run: RunConsole | null = null;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  afterEach(async () => {
    await run?.close();
    run = null;
  });

  async function stopFor(reason: 'PolicyConfirmation' | 'UnclassifiedCondition'): Promise<{ console: RunConsole; control: SessionControl; handover: Promise<Handover> }> {
    const tokens = createControlTokens('sess_000001', createSequentialIds());
    const control = createSessionControl({ sessionId: 'sess_000001', ids: createSequentialIds(), clock: systemClock, runId: 'run_000001', tokens });
    control.apply('start');
    const opened = await createRunConsole({
      control,
      screenshot: async () => new Uint8Array(PNG),
      redactor: createRedactor({ neverPersist: [], redactPatterns: [] }),
      known: [],
      clock: systemClock,
      ids: createSequentialIds(),
      claimTimeoutMs: 60_000,
      port: 0,
      announce: () => undefined,
      claimWindow: () => new Promise<void>(() => undefined),
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
    // The page has loaded the open intervention and is ready for a person.
    await page.locator('#status:has-text("Claim the session")').waitFor();
    return { console: opened, control, handover };
  }

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

// A one pixel PNG, so the console has something real to paint.
const PNG = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
  0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];
