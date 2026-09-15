import { describe, expect, it } from 'vitest';
import { parseFlags } from './args.js';

const ACCEPTED = ['capability', 'inputs', 'evidence'] as const;

describe('parseFlags', () => {
  it('reads each accepted flag and its value', () => {
    expect(parseFlags(['--capability', 'capabilities/a@1.0.0.json', '--evidence', 'out'], ACCEPTED)).toEqual({ ok: true, values: { capability: 'capabilities/a@1.0.0.json', evidence: 'out' } });
  });

  it('refuses a flag it does not accept without repeating the flag or its value', () => {
    const parsed = parseFlags(['--capability', 'a.json', '--memberId', '10001'], ACCEPTED);

    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toMatch(/memberId|10001/);
  });

  it('refuses a bare value without repeating it', () => {
    const parsed = parseFlags(['10001'], ACCEPTED);

    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain('10001');
  });

  it('refuses a flag with no value and a flag given twice', () => {
    expect(parseFlags(['--capability'], ACCEPTED).ok).toBe(false);
    expect(parseFlags(['--capability', '--inputs', 'x.json'], ACCEPTED).ok).toBe(false);
    expect(parseFlags(['--inputs', 'a.json', '--inputs', 'b.json'], ACCEPTED).ok).toBe(false);
  });
});
