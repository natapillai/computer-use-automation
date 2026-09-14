import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { Allowlist } from '../core/policy/allowlist.js';

export type AllowlistLoad =
  | { readonly ok: true; readonly allowlist: Allowlist }
  | { readonly ok: false; readonly failure: 'AllowlistInvalid'; readonly message: string };

// Reads and validates policy/allowlist.yaml. Every failure is a typed value, because a
// run that cannot load its policy must refuse to start rather than start permissive.
export async function loadAllowlist(path: string): Promise<AllowlistLoad> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return invalid(`The allowlist at ${path} could not be read.`);
  }

  let document: unknown;
  try {
    document = parse(text);
  } catch {
    return invalid(`The allowlist at ${path} is not valid YAML.`);
  }

  const parsed = Allowlist.safeParse(document);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`);
    return invalid(`The allowlist at ${path} is invalid. ${problems.join('. ')}.`);
  }
  return { ok: true, allowlist: parsed.data };
}

function invalid(message: string): AllowlistLoad {
  return { ok: false, failure: 'AllowlistInvalid', message };
}
