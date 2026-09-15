import type { ControlToken } from '../control/controlToken.js';
import type { Resolution } from '../core/locator/resolve.js';
import type { LocatorBundle, LocatorStrategy } from '../core/locator/schema.js';
import type { ActionResult, Observation, ResolvedAction } from '../core/surfaceModel/types.js';

export type SurfaceKind = 'web' | 'legacy-web' | 'desktop';

// The central seam, see docs/ARCHITECTURE.md section 3 and ADR 0008. Reading needs no
// token. Resolving and acting do, because a ref is only meaningful to the holder of the
// session it was observed in. capture lands with the evidence sink at S3-T03.
export interface SurfaceDriver {
  readonly kind: SurfaceKind;
  readonly sessionId: string;

  observe(): Promise<Observation>;

  // The port the core resolver and the condition evaluator call. Refs of the nodes one
  // strategy matches in the current observation, in document order.
  match(strategy: LocatorStrategy, framePath: readonly string[]): Promise<readonly string[]>;

  // The live url of the frame at a path, or null when there is no such frame. It takes no
  // snapshot, so asking never moves the observation a ref is checked against.
  frameUrl(framePath: readonly string[]): Promise<string | null>;

  // Resolves 'changed' once the surface differs from the most recent observation, at once
  // if it already does, or 'timeout' when timeoutMs passes first. Every wait in the
  // system is built on this and on a condition, never on a sleep.
  waitForChange(timeoutMs: number): Promise<'changed' | 'timeout'>;

  // A PNG of the whole surface with every element named by these refs painted over before
  // the bytes exist, so an unmasked image of a member's data never reaches the process.
  // Refs are checked against the latest observation like any other ref.
  screenshot(maskRefs: readonly string[]): Promise<Uint8Array>;

  resolve(bundle: LocatorBundle, control: ControlToken): Promise<Resolution>;

  // Throws ControlLostError before touching the surface when the token is not current.
  act(action: ResolvedAction, control: ControlToken): Promise<ActionResult>;

  close(): Promise<void>;
}
