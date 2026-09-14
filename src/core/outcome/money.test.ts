import { describe, expect, it } from 'vitest';
import { parseMoney } from './money.js';

describe('parseMoney', () => {
  it('parses a dollar amount with thousands separators into minor units', () => {
    expect(parseMoney('$4,250.75', 'USD')).toEqual({
      ok: true,
      value: { type: 'money', amountMinor: 425_075, currency: 'USD', raw: '$4,250.75' },
    });
  });

  it('parses an amount followed by its currency code', () => {
    expect(parseMoney('4250.75 USD', 'USD')).toEqual({
      ok: true,
      value: { type: 'money', amountMinor: 425_075, currency: 'USD', raw: '4250.75 USD' },
    });
  });

  it('reads parentheses as a negative amount', () => {
    expect(parseMoney('(125.00)', 'USD')).toMatchObject({ ok: true, value: { amountMinor: -12_500 } });
  });

  it('reads a leading minus as a negative amount', () => {
    expect(parseMoney('-$12.50', 'USD')).toMatchObject({ ok: true, value: { amountMinor: -1_250 } });
  });

  it('parses a zero balance as zero rather than negative zero', () => {
    const result = parseMoney('$0.00', 'USD');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.is(result.value.amountMinor, 0)).toBe(true);
  });

  it('tolerates the whitespace a table cell carries', () => {
    expect(parseMoney('  $4,250.75 ', 'USD')).toMatchObject({ ok: true, value: { amountMinor: 425_075, raw: '$4,250.75' } });
  });

  it('returns a typed failure for text that is not money, never NaN', () => {
    expect(parseMoney('N/A', 'USD')).toEqual({ ok: false, reason: 'unparseable' });
    expect(parseMoney('4,25.75', 'USD')).toEqual({ ok: false, reason: 'unparseable' });
  });

  it('refuses an amount in a different currency than the output declares', () => {
    expect(parseMoney('12.00 EUR', 'USD')).toEqual({ ok: false, reason: 'currencyMismatch' });
  });
});
