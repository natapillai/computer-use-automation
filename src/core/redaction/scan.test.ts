import { describe, expect, it } from 'vitest';
import { scanText, type ScanRules } from './scan.js';

const rules: ScanRules = {
  canaries: ['10001', 'Test Member One', '$4,250.75', '4111 1111 1111 1111', '4111111111111111'],
  patterns: [
    { name: 'ssn', pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: 'g' },
    { name: 'cardNumber', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', flags: 'g', validator: 'luhn' },
  ],
};

describe('scanText', () => {
  it('finds a planted canary with its file and line, and never repeats the value', () => {
    const hits = scanText('evidence/replay/success/run_1/log.jsonl', '{"event":"start"}\n{"member":"Test Member One"}\n', rules);

    expect(hits).toEqual([{ file: 'evidence/replay/success/run_1/log.jsonl', line: 2, kind: 'canary' }]);
    expect(JSON.stringify(hits)).not.toContain('Test Member One');
  });

  it('finds every canary on a line, including a balance and a card written without spaces', () => {
    const hits = scanText('trace.jsonl', 'balance $4,250.75 card 4111111111111111', rules);

    expect(hits.filter((hit) => hit.kind === 'canary')).toHaveLength(2);
  });

  it('finds what the redaction patterns would have caught', () => {
    expect(scanText('log.jsonl', 'ssn 123-45-6789', rules)).toEqual([{ file: 'log.jsonl', line: 1, kind: 'ssn' }]);
  });

  it('matches a numeric canary only as a whole number, so a longer id is not a leak', () => {
    expect(scanText('manifest.json', '"input_tokens": 100012, "member": 10001', rules)).toEqual([{ file: 'manifest.json', line: 1, kind: 'canary' }]);
    expect(scanText('manifest.json', '"input_tokens": 100012', rules)).toEqual([]);
  });

  it('passes text that only carries redaction markers and templates', () => {
    expect(scanText('log.jsonl', '{"url":"/member/{{inputs.memberId}}","card":"[redacted:cardNumber]","name":"[redacted:pii]"}', rules)).toEqual([]);
  });

  it('refuses to run with no canaries, because an empty list would pass anything', () => {
    expect(() => scanText('log.jsonl', 'anything', { ...rules, canaries: [] })).toThrow(TypeError);
  });
});
