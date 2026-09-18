import type { CDPSession, Frame, Page } from 'playwright';
import type { Allowlist } from '../../core/policy/allowlist.js';
import { checkUrl } from '../../core/policy/authorize.js';
import { deriveBundle } from '../../core/locator/derive.js';
import { sensitiveFields, type AppProfile } from '../../core/policy/profile.js';
import type { Redactor } from '../../core/redaction/redactor.js';
import { walkNodes } from '../../core/surfaceModel/tree.js';
import type { Observation, UINode } from '../../core/surfaceModel/types.js';
import type { HumanActionRecord, HumanInputPort, HumanNavigation } from '../../escalation/humanInput.js';
import type { Clock } from '../../runtime/clock.js';

// Input forwarding for a person holding the session, see docs/ESCALATION.md section 6. The
// console draws the masked screenshot and sends back the point that was clicked, so the
// coordinate is in page space and may land in any frame.
//
// Before the click is dispatched the point is hit tested through CDP, which resolves a node in
// whatever frame owns it without injecting anything into the page. The node's role and name are
// then matched against a fresh observation to find its ref, and the ordinary recorder derives
// the bundle from there, so a human action carries a locator derived and verified exactly like a
// model driven one. When the hit test names nothing unique the action is still recorded, with no
// target, because an audit record that omits an action is worse than one that cannot name it.

export interface WebHumanInputOptions {
  readonly page: Page;
  readonly observe: () => Promise<Observation>;
  readonly profile: AppProfile;
  readonly redactor: Redactor;
  readonly clock: Clock;
  // A navigation a person asks for is judged by the same allowlist every request is judged by,
  // before it is attempted rather than after it has already left.
  readonly allowlist: Allowlist;
  readonly baseUrl: string;
  readonly navigationTimeoutMs?: number;
}

// What the hit test learned about the element under the point. The role is deliberately not
// used. CDP reports an internal role, LayoutTableCell for the cell the target app submits on,
// where the accessibility snapshot reports cell, and matching two role vocabularies would break
// on exactly the non semantic controls this system exists to drive. The accessible name is the
// same in both, and the box size settles a tie without needing frame offsets.
interface HitNode {
  readonly name: string;
  readonly width: number | null;
  readonly height: number | null;
}

export function createWebHumanInput(options: WebHumanInputOptions): HumanInputPort {
  let cdp: CDPSession | null = null;

  const session = async (): Promise<CDPSession> => {
    if (cdp === null) {
      cdp = await options.page.context().newCDPSession(options.page);
      await cdp.send('DOM.enable');
      await cdp.send('Accessibility.enable');
    }
    return cdp;
  };

  const hitTest = async (x: number, y: number): Promise<HitNode | null> => {
    try {
      const located: unknown = await (await session()).send('DOM.getNodeForLocation', { x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false });
      const backendNodeId: unknown = typeof located === 'object' && located !== null ? Reflect.get(located, 'backendNodeId') : undefined;
      if (typeof backendNodeId !== 'number') return null;

      const tree: unknown = await (await session()).send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false });
      const nodes: unknown = typeof tree === 'object' && tree !== null ? Reflect.get(tree, 'nodes') : undefined;
      const named = Array.isArray(nodes) ? nodes.map((node: unknown) => valueOf(node, 'name')).find((name) => name !== null && name.trim() !== '') : undefined;
      if (named === undefined || named === null) return null;

      const boxed: unknown = await (await session()).send('DOM.getBoxModel', { backendNodeId });
      const model: unknown = typeof boxed === 'object' && boxed !== null ? Reflect.get(boxed, 'model') : undefined;
      const width: unknown = typeof model === 'object' && model !== null ? Reflect.get(model, 'width') : undefined;
      const height: unknown = typeof model === 'object' && model !== null ? Reflect.get(model, 'height') : undefined;

      return { name: named, width: typeof width === 'number' ? width : null, height: typeof height === 'number' ? height : null };
    } catch {
      // A point over no node at all, or a frame that went away mid click. The action is still
      // dispatched and still recorded, without a target.
      return null;
    }
  };

  // The bundle is derived from the screen the person was looking at when they clicked, not from
  // whatever the click then produced.
  const record = async (kind: 'click' | 'press', hit: HitNode | null, seen: Observation | null, key?: string): Promise<HumanActionRecord> => {
    const observation = seen ?? (await options.observe());
    const target = hit === null ? null : describe(observation, hit, options);
    return {
      at: options.clock.now().toISOString(),
      kind,
      target,
      // A path can carry a member id, so the url is redacted like everything else written down.
      url: options.redactor.text(options.page.url(), { known: [] }),
      ...(key === undefined ? {} : { key }),
    };
  };

  return {
    click: async ({ x, y }) => {
      const seen = await options.observe();
      const hit = await hitTest(x, y);
      await options.page.mouse.click(x, y);
      return record('click', hit, seen);
    },
    // A keystroke names no element, and what was typed is never captured.
    press: async (key) => {
      await options.page.keyboard.press(key);
      return record('press', null, null, key);
    },
    navigate: async ({ path, framePath }): Promise<HumanNavigation> => {
      // The frameset is the session. Moving the top window would replace every frame the run
      // is holding refs into, so a person is given the frames and never the window.
      if (framePath.length === 0) {
        return { ok: false, reason: 'topLevel', detail: 'The top window is the session itself, so only a named frame can be moved.' };
      }
      let href: string;
      try {
        href = new URL(path, options.baseUrl).href;
      } catch {
        return { ok: false, reason: 'notAllowed', detail: 'That is not a path this session can resolve.' };
      }
      const allowed = checkUrl(options.allowlist, href);
      if (!allowed.allowed) return { ok: false, reason: 'notAllowed', detail: allowed.reason };

      const frame = frameAt(options.page, framePath);
      if (frame === null) return { ok: false, reason: 'noFrame', detail: 'There is no frame at that frame path.' };
      try {
        await frame.goto(href, { timeout: options.navigationTimeoutMs ?? 10_000 });
      } catch {
        return { ok: false, reason: 'failed', detail: 'The navigation did not complete in time.' };
      }
      return {
        ok: true,
        record: {
          at: options.clock.now().toISOString(),
          kind: 'navigate',
          target: null,
          url: options.redactor.text(options.page.url(), { known: [] }),
          // Redacted like the url, because a path carries a member id.
          path: options.redactor.text(path, { known: [] }),
          framePath: [...framePath],
        },
      };
    },
  };
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

function describe(observation: Observation, hit: HitNode, options: WebHumanInputOptions): HumanActionRecord['target'] {
  const collapsed = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const named = [...walkNodes(observation.root)].filter((node: UINode) => collapsed(node.name) !== '' && collapsed(node.name) === collapsed(hit.name));
  // One element with that name is the answer. Several means the size decides, and if it cannot,
  // the action is recorded with no target rather than with a guess.
  const sized = (node: UINode): boolean => hit.width !== null && hit.height !== null && Math.abs(node.box.width - hit.width) <= 2 && Math.abs(node.box.height - hit.height) <= 2;
  const node = named.length === 1 ? named[0] : named.filter(sized).length === 1 ? named.find(sized) : undefined;
  if (node === undefined) return null;

  const derived = deriveBundle(observation, node.ref, {
    inputs: {},
    sensitive: sensitiveFields(options.profile, observation),
    redacts: (text) => options.redactor.text(text, { known: [] }) !== text,
  });
  return derived.ok ? { describedAs: derived.bundle.describedAs, bundle: derived.bundle } : null;
}

function valueOf(node: unknown, field: string): string | null {
  if (typeof node !== 'object' || node === null) return null;
  const holder: unknown = Reflect.get(node, field);
  if (typeof holder !== 'object' || holder === null) return null;
  const value: unknown = Reflect.get(holder, 'value');
  return typeof value === 'string' ? value : null;
}
