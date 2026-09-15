import { readFile } from 'node:fs/promises';
import { AppProfile } from '../core/policy/profile.js';

export type ProfileLoad =
  | { readonly ok: true; readonly profile: AppProfile }
  | { readonly ok: false; readonly failure: 'ProfileInvalid'; readonly message: string };

// Reads and validates profiles/<appId>.json. A wrong profile is a safety defect, so a run
// that cannot load one refuses to start rather than starting with nothing classified.
export async function loadProfile(path: string): Promise<ProfileLoad> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return invalid(`The app profile at ${path} could not be read.`);
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return invalid(`The app profile at ${path} is not valid JSON.`);
  }

  const parsed = AppProfile.safeParse(document);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`);
    return invalid(`The app profile at ${path} is invalid. ${problems.join('. ')}.`);
  }
  return { ok: true, profile: parsed.data };
}

function invalid(message: string): ProfileLoad {
  return { ok: false, failure: 'ProfileInvalid', message };
}
