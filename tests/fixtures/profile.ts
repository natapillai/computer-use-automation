import type { AppProfile } from '../../src/core/policy/profile.js';
import { loadProfile } from '../../src/runtime/profile.js';

// The committed MERIDIAN Core profile, loaded the way a run loads it.
export async function meridianProfile(): Promise<AppProfile> {
  const loaded = await loadProfile('profiles/meridian-core.json');
  if (!loaded.ok) throw new Error(`The committed profile did not load. ${loaded.message}`);
  return loaded.profile;
}
