import type { ControlToken } from '../../control/controlToken.js';
import type { Resolution } from '../../core/locator/resolve.js';
import type { LocatorBundle, LocatorStrategy } from '../../core/locator/schema.js';
import type { ActionResult, ActionVerb, Observation, ResolvedAction } from '../../core/surfaceModel/types.js';
import type { SurfaceDriver } from '../types.js';

// The desktop seam, see docs/ARCHITECTURE.md section 3. This is a stub on purpose. The brief
// permits it, and what it is here to prove is that nothing above the SurfaceDriver interface
// knows it is driving a browser. It satisfies the interface, so the compiler checks that claim
// on every build, and every method refuses by name so a run can never get halfway on a surface
// that does not exist.
//
// The mapping below is the part worth reading. It is what a real implementation would be
// written against, and writing it out is how I found that the vocabulary needed nothing added
// for a desktop surface. The one thing that does change is where geometry comes from. On the
// web a box is a layout rectangle from the accessibility snapshot. On Windows it is the
// BoundingRectangle property of an automation element, in screen coordinates, so the
// anchor relative strategies compare rectangles exactly as they do now and the relations
// sameRow, rightOf and firstBelow carry over unchanged.

export class NotImplementedError extends Error {
  readonly method: string;

  constructor(method: string) {
    super(`The desktop surface driver does not implement ${method}. It is a documented seam, not a working driver.`);
    this.name = 'NotImplementedError';
    this.method = method;
  }
}

// One line per verb, naming the UI Automation control pattern a real driver would use.
export type VerbMapping = Readonly<Record<ActionVerb, string>>;

const MAPPING: VerbMapping = {
  navigate: 'There is no address bar. A path becomes a window to focus, found by AutomationId or Name on the desktop root, then activated through the Window pattern.',
  click: 'Invoke pattern on the element, falling back to SelectionItem for a list row and Toggle for a check box, because not every clickable control invokes.',
  fill: 'Value pattern SetValue, which replaces the whole value rather than typing, so a masked field does not receive keystrokes one at a time.',
  select: 'SelectionItem pattern Select on the option, found by Name under the combo box, after ExpandCollapse where the control needs opening first.',
  press: 'SendInput to the focused element, because a key is not a pattern and no control exposes one.',
  hover: 'Move the cursor to the centre of the BoundingRectangle, since there is no hover pattern and tooltips are raised by the cursor itself.',
  scroll: 'Scroll pattern on the nearest ancestor that exposes it, by ScrollAmount rather than by pixels, because a desktop list scrolls by item.',
  waitFor: 'Not an action a driver performs. It is a condition the executor races, and on this surface it polls the automation tree the same way it polls a page.',
  extract: 'Value pattern or the Name property, whichever the control exposes, read without focusing so reading cannot change what is selected.',
  assert: 'Not an action a driver performs. It is a checkpoint the executor evaluates against the observation.',
  dismiss: 'Invoke on the button the Window pattern names as the close control, used only for a dialog a profile has classified, never to clear one nobody declared.',
};

export interface DesktopSurfaceOptions {
  readonly sessionId: string;
}

export interface DesktopSurfaceDriver extends SurfaceDriver {
  readonly mapping: VerbMapping;
}

export function createDesktopSurfaceDriver(options: DesktopSurfaceOptions): DesktopSurfaceDriver {
  const refuse = (method: string): Promise<never> => Promise.reject(new NotImplementedError(method));

  return {
    kind: 'desktop',
    sessionId: options.sessionId,
    mapping: MAPPING,
    observe: (): Promise<Observation> => refuse('observe'),
    match: (_strategy: LocatorStrategy, _framePath: readonly string[]): Promise<readonly string[]> => refuse('match'),
    frameUrl: (_framePath: readonly string[]): Promise<string | null> => refuse('frameUrl'),
    waitForChange: (_timeoutMs: number): Promise<'changed' | 'timeout'> => refuse('waitForChange'),
    screenshot: (_maskRefs: readonly string[]): Promise<Uint8Array> => refuse('screenshot'),
    resolve: (_bundle: LocatorBundle, _control: ControlToken): Promise<Resolution> => refuse('resolve'),
    act: (_action: ResolvedAction, _control: ControlToken): Promise<ActionResult> => refuse('act'),
    // Releasing nothing is not an unimplemented feature, and a caller that closes every driver
    // in a finally should not have to know which kind it holds.
    close: async (): Promise<void> => undefined,
  };
}
