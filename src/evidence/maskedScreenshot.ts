import { sensitiveFields, type AppProfile } from '../core/policy/profile.js';
import type { GuardedSurface } from '../surface/guardedSurface.js';

// The only kind of screenshot this system takes, see docs/SAFETY.md section 4. Playwright paints
// over the masked regions before the bytes exist, so there is never an unmasked image to leak.
//
// One function because three commands and the evidence sink all need it, and the version of it
// that was copied into each of them was a line nothing asserted. Passing an empty list there
// would have served a person an unmasked member record and every test would still have passed.

export function maskedScreenshot(surface: GuardedSurface, profile: AppProfile): () => Promise<Uint8Array> {
  return async () => {
    const observation = await surface.observe();
    return surface.screenshot([...sensitiveFields(profile, observation).keys()]);
  };
}
