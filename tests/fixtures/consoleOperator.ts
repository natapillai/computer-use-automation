import type { Browser, Page } from 'playwright';

// A person at the operator console, in a real browser, doing what a person does. Everything
// goes through the page, because the page is the thing that was broken while the API under it
// worked. Nothing here talks to the API directly.

export interface ConsoleSession {
  readonly page: Page;
  // A point in the live page's own coordinates, which the person reaches by clicking the right
  // part of the picture. The console does the mapping, so this undoes it to know where to aim.
  click(point: { readonly x: number; readonly y: number }): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
  navigate(path: string, frame?: string): Promise<void>;
}

export interface ConsolePlan {
  // What the person does while they hold the session. Omitted means they only looked.
  readonly work?: (session: ConsoleSession) => Promise<void>;
  readonly finish: 'approve' | 'release' | 'abort';
}

export interface ConsoleVisit {
  readonly interventionId: string;
  readonly reason: string;
  readonly explanation: string;
}

const FINISH = { approve: '#approve', release: '#release', abort: '#abort' } as const;

export async function personAtTheConsole(browser: Browser, consoleUrl: string, plan: ConsolePlan): Promise<ConsoleVisit> {
  const page = await browser.newPage();
  try {
    await page.goto(consoleUrl);
    await page.locator('#status:has-text("Claim the session")').waitFor();
    // The picture is on screen before anybody claims, which is how a person decides whether to.
    await page.waitForFunction('document.getElementById("canvas").width > 1');

    const context = await page.locator('#context').innerText();
    const reason = fieldAfter(context, 'Why it stopped');
    const explanation = fieldAfter(context, 'What happened');

    await page.click('#claim');
    await page.locator('#status:has-text("You hold the session")').waitFor();

    if (plan.work !== undefined) await plan.work(sessionOn(page));

    await page.click(FINISH[plan.finish]);
    await page.locator('#status:has-text("automation")').waitFor();

    return { interventionId: consoleUrl.split('/').filter((part) => part !== '').at(-1) ?? '', reason, explanation };
  } finally {
    await page.close();
  }
}

function sessionOn(page: Page): ConsoleSession {
  const sent = (): Promise<void> => page.locator('#status:has-text("Sent")').waitFor().then(() => undefined);

  return {
    page,
    click: async (point) => {
      const box = await page.locator('#canvas').boundingBox();
      const width = await page.evaluate('document.getElementById("canvas").width');
      if (box === null || typeof width !== 'number' || width === 0) throw new Error('The console is not showing a screen to click on.');
      const scale = box.width / width;
      await page.mouse.click(box.x + point.x * scale, box.y + point.y * scale);
      await sent();
    },
    type: async (text) => {
      await page.click('#canvas');
      await page.keyboard.type(text);
      await sent();
    },
    press: async (key) => {
      await page.click('#canvas');
      await page.keyboard.press(key);
      await sent();
    },
    navigate: async (path, frame = 'content') => {
      await page.fill('#frame', frame);
      await page.fill('#path', path);
      await page.click('#go');
      await page.locator('#status:has-text("moved")').waitFor();
    },
  };
}

// The console renders its context as a definition list, so a field is the line after its term.
function fieldAfter(text: string, term: string): string {
  const lines = text.split('\n').map((line) => line.trim());
  const at = lines.indexOf(term);
  return at === -1 ? '' : (lines[at + 1] ?? '');
}
