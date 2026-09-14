import type { Frame, Page } from 'playwright';
import type { ControlGate } from '../../control/controlToken.js';
import { resolveBundle } from '../../core/locator/resolve.js';
import { deriveLabels } from '../../core/surfaceModel/derivedLabel.js';
import { sameFramePath } from '../../core/surfaceModel/geometry.js';
import { matchStrategy } from '../../core/surfaceModel/match.js';
import { findNodeByRef, walkNodes } from '../../core/surfaceModel/tree.js';
import type { ActionResult, Observation, ResolvedAction } from '../../core/surfaceModel/types.js';
import type { SurfaceDriver } from '../types.js';
import { iframeRefsOf, toUINodeTree } from './snapshot.js';

// The Playwright driver. Perception is the accessibility snapshot with boxes, refs map
// back to live elements through aria-ref locators, and every frame is traversed. This is
// the mechanism S0-T03 proved, see ADR 0012.

export interface WebSurfaceOptions {
  readonly page: Page;
  readonly sessionId: string;
  readonly control: ControlGate;
  readonly baseUrl: string;
  readonly actionTimeoutMs?: number;
}

type RefAction = Exclude<ResolvedAction, { kind: 'navigate' }>;

const DEFAULT_ACTION_TIMEOUT_MS = 5_000;
const OK: ActionResult = { ok: true };

export function createWebSurfaceDriver(options: WebSurfaceOptions): SurfaceDriver {
  const { page, sessionId, control, baseUrl } = options;
  const timeout = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const statuses = new WeakMap<Frame, number>();

  // The observation the caller was last given. A ref only means something against it,
  // so it is cleared by every action and by a failed ref check.
  let latest: Observation | null = null;

  page.on('response', (response) => {
    const request = response.request();
    if (!request.isNavigationRequest()) return;
    try {
      statuses.set(request.frame(), response.status());
    } catch {
      // A service worker request has no frame, and nothing here observes it.
    }
  });

  const snapshot = async (): Promise<Observation> => {
    const json: unknown = await page.ariaSnapshotJSON({ mode: 'ai', boxes: true });
    const frameNames = new Map<string, string>();
    for (const ref of iframeRefsOf(json)) {
      try {
        const handle = await page.locator(`aria-ref=${ref}`).elementHandle({ timeout });
        const frame = await handle.contentFrame();
        if (frame !== null) frameNames.set(ref, frame.name());
        await handle.dispose();
      } catch {
        // An iframe that detached mid snapshot keeps a placeholder segment.
      }
    }
    const root = deriveLabels(toUINodeTree(json, frameNames));
    return {
      root,
      frames: page.frames().map((frame) => ({ framePath: framePathOf(frame), url: frame.url(), lastStatus: statuses.get(frame) ?? null })),
      dialogOpen: [...walkNodes(root)].some((node) => node.role === 'dialog' || node.role === 'alertdialog'),
    };
  };

  const refresh = async (): Promise<Observation> => {
    latest = await snapshot();
    return latest;
  };

  const navigate = async (path: string, framePath: readonly string[]): Promise<ActionResult> => {
    latest = null;
    const frame = frameAt(page, framePath);
    if (frame === null) return { ok: false, reason: 'navigation_failed', detail: 'No frame exists at that frame path.' };
    try {
      await frame.goto(new URL(path, baseUrl).href, { timeout });
      return OK;
    } catch {
      return { ok: false, reason: 'navigation_failed', detail: 'The navigation did not complete within the action timeout.' };
    }
  };

  const actOnRef = async (action: RefAction): Promise<ActionResult> => {
    const observed = latest === null ? null : findNodeByRef(latest.root, action.ref);
    latest = null;
    if (observed === null) {
      return { ok: false, reason: 'not_found', detail: 'That ref is not in the most recent observation. Observe before acting.' };
    }

    // Playwright reissues refs on every snapshot, and after the page changes a ref can
    // name a different element. The S1-T08 probe saw a search field's ref name the card
    // number cell on the next page. So the ref is checked against a fresh snapshot, which
    // is also the snapshot the aria-ref locator resolves against, before anything is touched.
    const current = findNodeByRef((await snapshot()).root, action.ref);
    if (current === null || current.role !== observed.role || current.name !== observed.name || !sameFramePath(current.framePath, observed.framePath)) {
      return { ok: false, reason: 'not_found', detail: 'The element behind that ref changed since it was observed. Observe again.' };
    }
    if (current.state.disabled) return { ok: false, reason: 'disabled', detail: 'The element is disabled.' };

    const locator = page.locator(`aria-ref=${action.ref}`);
    try {
      switch (action.kind) {
        case 'click':
        case 'dismiss':
          await locator.click({ timeout });
          break;
        case 'fill':
          await locator.fill(action.value, { timeout });
          break;
        case 'select':
          await locator.selectOption(action.value, { timeout });
          break;
        case 'press':
          await locator.press(action.key, { timeout });
          break;
        case 'hover':
          await locator.hover({ timeout });
          break;
        case 'scroll':
          await locator.scrollIntoViewIfNeeded({ timeout });
          break;
      }
      return OK;
    } catch {
      // Playwright's message can quote the element's markup, which can carry member data.
      return { ok: false, reason: 'not_actionable', detail: 'The element could not be acted on within the action timeout.' };
    }
  };

  return {
    kind: 'legacy-web',
    sessionId,
    observe: refresh,
    match: async (strategy, framePath) => matchStrategy(latest ?? (await refresh()), strategy, framePath),
    frameUrl: async (framePath) => frameAt(page, framePath)?.url() ?? null,
    resolve: async (bundle, token) => {
      control.assertCurrent(token);
      const observation = await refresh();
      return resolveBundle(bundle, async (strategy, framePath) => matchStrategy(observation, strategy, framePath));
    },
    act: async (action, token) => {
      control.assertCurrent(token);
      return action.kind === 'navigate' ? navigate(action.path, action.framePath) : actOnRef(action);
    },
    close: async () => {
      await page.close();
    },
  };
}

function framePathOf(frame: Frame): readonly string[] {
  const path: string[] = [];
  let current = frame;
  let parent = current.parentFrame();
  while (parent !== null) {
    path.unshift(current.name());
    current = parent;
    parent = current.parentFrame();
  }
  return path;
}

function frameAt(page: Page, framePath: readonly string[]): Frame | null {
  let frame = page.mainFrame();
  for (const segment of framePath) {
    const child = frame.childFrames().find((candidate) => candidate.name() === segment);
    if (child === undefined) return null;
    frame = child;
  }
  return frame;
}
