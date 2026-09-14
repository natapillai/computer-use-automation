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

  resolve(bundle: LocatorBundle, control: ControlToken): Promise<Resolution>;

  // Throws ControlLostError before touching the surface when the token is not current.
  act(action: ResolvedAction, control: ControlToken): Promise<ActionResult>;

  close(): Promise<void>;
}
