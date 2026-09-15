import { describe, expect, it } from 'vitest';
import { createRedactor, type RedactionContext } from './redactor.js';

// The patterns and keys from policy/allowlist.yaml, see docs/SAFETY.md section 2.
const redactor = createRedactor({
  neverPersist: ['password', 'token', 'ssn', 'cardNumber', 'cvv', 'pin', 'apiKey'],
  redactPatterns: [
    { name: 'ssn', pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: 'g' },
    { name: 'cardNumber', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', flags: 'g', validator: 'luhn' },
    { name: 'email', pattern: '\\b[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}\\b', flags: 'gi' },
    { name: 'phone', pattern: '\\b(?:\\+?1[ .-]?)?\\(?\\d{3}\\)?[ .-]?\\d{3}[ .-]?\\d{4}\\b', flags: 'g' },
    { name: 'accountNumber', pattern: '\\b\\d{9,17}\\b', flags: 'g', contextual: true },
  ],
});

const none: RedactionContext = { known: [] };
const memberId: RedactionContext = { known: [{ value: '10001', replacement: '{{inputs.memberId}}' }] };

describe('Redactor.text', () => {
  it.each([
    ['ssn', 'SSN 123-45-6789 on file', 'SSN [redacted:ssn] on file'],
    ['cardNumber', 'Card: 4111 1111 1111 1111', 'Card: [redacted:cardNumber]'],
    ['email', 'Contact test.member@example.com today', 'Contact [redacted:email] today'],
    ['phone', 'Call 555-123-4567', 'Call [redacted:phone]'],
    ['accountNumber', 'Account 123456789012', 'Account [redacted:accountNumber]'],
  ])('redacts a %s', (_name, input, expected) => {
    expect(redactor.text(input, none)).toBe(expected);
  });

  it.each([
    ['ssn', 'Ref 12-345-6789'],
    ['email', 'Reply at the desk @ branch'],
    ['phone', 'Ext 12-34'],
    ['accountNumber', 'Batch 12345678'],
  ])('leaves text that only resembles a %s', (_name, input) => {
    expect(redactor.text(input, none)).toBe(input);
  });

  it('does not call a card shaped number that fails the Luhn check a card', () => {
    expect(redactor.text('Card: 4111 1111 1111 1112', none)).not.toContain('[redacted:cardNumber]');
  });

  it('leaves timestamps and durations alone', () => {
    const line = '2026-09-15T02:08:36.117Z step took 1234ms';

    expect(redactor.text(line, none)).toBe(line);
  });

  it('replaces a known input value with its template, including inside a url', () => {
    expect(redactor.text('GET /member/10001 for member 10001.', memberId)).toBe('GET /member/{{inputs.memberId}} for member {{inputs.memberId}}.');
  });

  it('does not replace a known value inside a longer token', () => {
    expect(redactor.text('order 100012', memberId)).toBe('order 100012');
  });

  it('replaces a known output value such as a balance', () => {
    expect(redactor.text('balance $4,250.75 read', { known: [{ value: '$4,250.75', replacement: '[redacted:pii]' }] })).toBe('balance [redacted:pii] read');
  });

  it('reports how many times each pattern and known value matched, never what matched', () => {
    const counts: Record<string, number> = {};
    const tally = (name: string): void => {
      counts[name] = (counts[name] ?? 0) + 1;
    };

    redactor.text('member 10001 at /member/10001, card 4111 1111 1111 1111, mail test.member@example.com', { ...memberId, onMatch: tally });

    expect(counts).toEqual({ known: 2, cardNumber: 1, email: 1 });
  });

  it('redacts twice the same as once', () => {
    const once = redactor.text('member 10001, card 4111 1111 1111 1111, mail test.member@example.com, account 123456789012', memberId);

    expect(redactor.text(once, memberId)).toBe(once);
  });
});

describe('Redactor.object', () => {
  it('redacts every string in nested objects and arrays, and never mutates the input', () => {
    const input = { runId: 'run_000001', steps: [{ url: '/member/10001', notes: ['card 4111 1111 1111 1111'] }] };
    const before = JSON.parse(JSON.stringify(input)) as unknown;

    expect(redactor.object(input, memberId)).toEqual({
      runId: 'run_000001',
      steps: [{ url: '/member/{{inputs.memberId}}', notes: ['card [redacted:cardNumber]'] }],
    });
    expect(input).toEqual(before);
  });

  it('replaces the whole value under a never persist key, whatever its type', () => {
    const input = { username: 'operator', targetPassword: 'meridian-fixture', session: { accessToken: 42 }, cardNumber: '4111111111111111', spinner: 'on' };

    expect(redactor.object(input, none)).toEqual({
      username: 'operator',
      targetPassword: '[redacted:password]',
      session: { accessToken: '[redacted:token]' },
      cardNumber: '[redacted:cardNumber]',
      spinner: 'on',
    });
  });

  it('keeps binary data, marks a cycle, and still walks a value shared twice', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const shared = { note: 'member 10001' };
    const cyclic: Record<string, unknown> = { bytes, first: shared, second: shared };
    cyclic['self'] = cyclic;

    expect(redactor.object(cyclic, memberId)).toEqual({
      bytes,
      first: { note: 'member {{inputs.memberId}}' },
      second: { note: 'member {{inputs.memberId}}' },
      self: '[circular]',
    });
  });

  it('redacts an object twice the same as once', () => {
    const once = redactor.object({ trace: ['/member/10001', { email: 'test.member@example.com', pin: 1234 }] }, memberId);

    expect(redactor.object(once, memberId)).toEqual(once);
  });
});
