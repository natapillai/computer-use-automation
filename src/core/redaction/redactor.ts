import type { Allowlist } from '../policy/allowlist.js';

// The one redactor every sink uses, see docs/SAFETY.md section 4. Provenance first, then
// patterns, and in objects a key on the never persist list hides its whole value.

export interface KnownValue {
  readonly value: string;
  readonly replacement: string;
}

// Values this run knows are sensitive because it supplied or extracted them. Exact, and
// the primary mechanism. Patterns are the net for data nobody declared.
export interface RedactionContext {
  readonly known: readonly KnownValue[];
  // Called once per replacement with the pattern name, or known for a known value, so a
  // manifest can report counts without ever seeing a value.
  readonly onMatch?: (name: string) => void;
}

export interface Redactor {
  text(text: string, context: RedactionContext): string;
  object(value: unknown, context: RedactionContext): unknown;
}

type RedactionPolicy = Pick<Allowlist['data'], 'redactPatterns' | 'neverPersist'>;

interface CompiledPattern {
  readonly name: string;
  readonly expression: RegExp;
  readonly luhn: boolean;
}

export function createRedactor(policy: RedactionPolicy): Redactor {
  // contextual has no defined narrowing, so a contextual pattern applies everywhere. That
  // over redacts rather than under redacts, which is the direction a public repository needs.
  const patterns: readonly CompiledPattern[] = policy.redactPatterns.map((pattern) => ({
    name: pattern.name,
    expression: new RegExp(pattern.pattern, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`),
    luhn: pattern.validator === 'luhn',
  }));
  const neverPersist = policy.neverPersist.map((entry) => ({ entry, words: wordsOf(entry) }));

  const text = (input: string, context: RedactionContext): string => {
    let out = input;
    // Longest first, so a known value is never broken up by a shorter one inside it.
    const known = context.known.filter((item) => item.value !== '').sort((a, b) => b.value.length - a.value.length);
    for (const item of known) {
      out = out.replace(knownValuePattern(item.value), () => {
        context.onMatch?.('known');
        return item.replacement;
      });
    }
    for (const pattern of patterns) {
      out = out.replace(pattern.expression, (match) => {
        if (pattern.luhn && !passesLuhn(match)) return match;
        context.onMatch?.(pattern.name);
        return `[redacted:${pattern.name}]`;
      });
    }
    return out;
  };

  const object = (value: unknown, context: RedactionContext): unknown => {
    // ancestors is the path from the root, so a value shared by two branches is walked
    // twice and only a real cycle is cut.
    const walk = (current: unknown, ancestors: readonly object[]): unknown => {
      if (typeof current === 'string') return text(current, context);
      if (typeof current !== 'object' || current === null) return current;
      if (current instanceof Uint8Array || current instanceof ArrayBuffer || current instanceof Date) return current;
      if (ancestors.includes(current)) return '[circular]';
      const inside = [...ancestors, current];
      if (Array.isArray(current)) {
        const items: readonly unknown[] = current;
        return items.map((item) => walk(item, inside));
      }
      return Object.fromEntries(
        Object.entries(current).map(([key, item]: [string, unknown]) => {
          const rule = neverPersist.find((candidate) => containsWords(wordsOf(key), candidate.words));
          return [key, rule === undefined ? walk(item, inside) : `[redacted:${rule.entry}]`];
        }),
      );
    };
    return walk(value, []);
  };

  return { text, object };
}

// A value is matched as a whole token where it starts or ends with a word character, so
// member 10001 is redacted and order 100012 is not.
function knownValuePattern(value: string): RegExp {
  const start = /^\w/.test(value) ? '(?<!\\w)' : '';
  const end = /\w$/.test(value) ? '(?!\\w)' : '';
  return new RegExp(`${start}${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${end}`, 'g');
}

// accessToken, access_token and ACCESS-TOKEN all contain the words access and token, and
// spinner does not contain pin.
function wordsOf(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word !== '');
}

function containsWords(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

function passesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits.charAt(digits.length - 1 - i));
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
