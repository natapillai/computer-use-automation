import type { ControlGate } from '../../control/controlToken.js';
import { resolveBundle, type StrategyMatcher } from '../../core/locator/resolve.js';
import { matchStrategy } from '../../core/surfaceModel/match.js';
import { findNodeByRef } from '../../core/surfaceModel/tree.js';
import type { ActionResult, Observation, ResolvedAction, UINode } from '../../core/surfaceModel/types.js';
import type { SurfaceDriver } from '../types.js';

// An in memory surface with scripted screens and no browser, see docs/TESTING.md
// section 3. It enforces the control token and matches strategies through the same
// core code as the web driver, so the executor and the loop are tested against the
// semantics they meet in production.

export type FakeTrigger =
  | { readonly kind: 'click' | 'dismiss'; readonly ref: string }
  | { readonly kind: 'press'; readonly ref: string; readonly key: string }
  | { readonly kind: 'navigate'; readonly path: string };

export interface FakeTransition {
  readonly from: string;
  readonly on: FakeTrigger;
  readonly to: string;
}

export interface FakeScript {
  readonly start: string;
  readonly screens: Readonly<Record<string, Observation>>;
  readonly transitions: readonly FakeTransition[];
}

export interface FakeSurfaceDriver extends SurfaceDriver {
  readonly screen: string;
  readonly performed: readonly ResolvedAction[];
}

export interface FakeSurfaceOptions {
  readonly sessionId: string;
  readonly control: ControlGate;
  readonly script: FakeScript;
}

const OK: ActionResult = { ok: true };

export function createFakeSurfaceDriver(options: FakeSurfaceOptions): FakeSurfaceDriver {
  const { sessionId, control, script } = options;

  const screenNamed = (name: string): Observation => {
    const observation = script.screens[name];
    if (observation === undefined) throw new TypeError(`The fake script names a screen "${name}" that it does not define.`);
    return observation;
  };
  for (const transition of script.transitions) {
    screenNamed(transition.from);
    screenNamed(transition.to);
  }

  let screen = script.start;
  let current = screenNamed(screen);
  const performed: ResolvedAction[] = [];

  // Arriving on a screen is a new page load, so values filled on the last one are gone.
  const moveTo = (name: string): void => {
    screen = name;
    current = screenNamed(name);
  };

  const transitionFor = (action: ResolvedAction): FakeTransition | undefined =>
    script.transitions.find((transition) => transition.from === screen && triggers(transition.on, action));

  const perform = (action: ResolvedAction): ActionResult => {
    if (action.kind === 'navigate') {
      const transition = transitionFor(action);
      if (transition === undefined) {
        return { ok: false, reason: 'navigation_failed', detail: `The fake script has no navigation from screen "${screen}".` };
      }
      moveTo(transition.to);
      return OK;
    }

    const node = findNodeByRef(current.root, action.ref);
    if (node === null) return { ok: false, reason: 'not_found', detail: 'No node with that ref is on the current screen.' };
    if (node.state.disabled) return { ok: false, reason: 'disabled', detail: 'The node is disabled.' };

    if (action.kind === 'fill' || action.kind === 'select') {
      current = { ...current, root: withValue(current.root, action.ref, action.value) };
      return OK;
    }
    // An unscripted click leaves the screen as it was, the way a dead control does.
    const transition = transitionFor(action);
    if (transition !== undefined) moveTo(transition.to);
    return OK;
  };

  const match: StrategyMatcher = async (strategy, framePath) => matchStrategy(current, strategy, framePath);

  return {
    kind: 'legacy-web',
    sessionId,
    get screen() {
      return screen;
    },
    get performed() {
      return [...performed];
    },
    observe: async () => current,
    match,
    resolve: async (bundle, token) => {
      control.assertCurrent(token);
      return resolveBundle(bundle, match);
    },
    act: async (action, token) => {
      control.assertCurrent(token);
      performed.push(action);
      return perform(action);
    },
    close: async () => undefined,
  };
}

function triggers(on: FakeTrigger, action: ResolvedAction): boolean {
  switch (on.kind) {
    case 'navigate':
      return action.kind === 'navigate' && action.path === on.path;
    case 'press':
      return action.kind === 'press' && action.ref === on.ref && action.key === on.key;
    case 'click':
    case 'dismiss':
      return (action.kind === 'click' || action.kind === 'dismiss') && action.kind === on.kind && action.ref === on.ref;
  }
}

function withValue(node: UINode, ref: string, value: string): UINode {
  if (node.ref === ref) return { ...node, value };
  if (node.children.length === 0) return node;
  return { ...node, children: node.children.map((child) => withValue(child, ref, value)) };
}
