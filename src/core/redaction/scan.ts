import type { Allowlist } from '../policy/allowlist.js';
import { createRedactor } from './redactor.js';

// The check behind docs/EVIDENCE.md section 5. Patterns alone would only find what the
// redactor already catches, which is close to a tautology. The seeded canaries are what
// test whether every sink really went through the redactor.

export interface ScanRules {
  readonly canaries: readonly string[];
  readonly patterns: Allowlist['data']['redactPatterns'];
}

// Where a leak was found and what kind it was. Never the value.
export interface ScanHit {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
}

export function scanText(file: string, text: string, rules: ScanRules): readonly ScanHit[] {
  if (rules.canaries.length === 0) throw new TypeError('The scan has no canaries, so it would pass anything.');

  const redactor = createRedactor({ redactPatterns: rules.patterns, neverPersist: [] });
  // A member id is matched as a whole number, so a token count of 100012 is not a leak of
  // member 10001. Everything else is matched as a substring, which fails closed.
  const canaries = rules.canaries.filter((canary) => canary.trim() !== '').map((canary) => (/^\d+$/.test(canary) ? wholeNumber(canary) : (line: string) => line.includes(canary)));

  const hits: ScanHit[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const found of canaries) if (found(line)) hits.push({ file, line: index + 1, kind: 'canary' });
    redactor.text(line, { known: [], onMatch: (name) => hits.push({ file, line: index + 1, kind: name }) });
  });
  return hits;
}

function wholeNumber(digits: string): (line: string) => boolean {
  const pattern = new RegExp(`(?<!\\d)${digits}(?!\\d)`);
  return (line) => pattern.test(line);
}
