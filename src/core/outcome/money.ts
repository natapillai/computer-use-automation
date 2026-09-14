import type { TypedValue } from './result.js';

export type MoneyValue = Extract<TypedValue, { type: 'money' }>;

export type MoneyParse =
  | { readonly ok: true; readonly value: MoneyValue }
  | { readonly ok: false; readonly reason: 'unparseable' | 'currencyMismatch' };

// Either grouped thousands or plain digits, then an optional two digit fraction.
const AMOUNT = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?$/;
const TRAILING_CODE = /^(.*?)\s*([A-Z]{3})$/;

// A balance is not a float. The amount is integer minor units, so 4,250.75 is 425075
// cents with no rounding anywhere. The raw text is kept for debugging and is pii, so
// it is redacted in every persisted projection. A failure never carries it.
export function parseMoney(text: string, currency: string): MoneyParse {
  const raw = text.trim();
  let body = raw;
  let negative = false;

  const parenthesised = /^\((.*)\)$/.exec(body)?.[1];
  if (parenthesised !== undefined) {
    negative = true;
    body = parenthesised.trim();
  }
  if (body.startsWith('-')) {
    negative = true;
    body = body.slice(1).trim();
  }

  let declared: string | null = null;
  const withCode = TRAILING_CODE.exec(body);
  if (withCode?.[1] !== undefined && withCode[2] !== undefined) {
    declared = withCode[2];
    body = withCode[1].trim();
  }
  if (body.startsWith('$')) {
    declared ??= 'USD';
    body = body.slice(1).trim();
  }

  if (declared !== null && declared !== currency) return { ok: false, reason: 'currencyMismatch' };
  if (!AMOUNT.test(body)) return { ok: false, reason: 'unparseable' };

  const [whole = '', fraction = '00'] = body.split('.');
  const minor = Number(whole.replaceAll(',', '')) * 100 + Number(fraction);
  if (!Number.isSafeInteger(minor)) return { ok: false, reason: 'unparseable' };

  // Zero stays zero. A negative zero would compare unequal in strict checks downstream.
  const amountMinor = negative && minor !== 0 ? -minor : minor;
  return { ok: true, value: { type: 'money', amountMinor, currency, raw } };
}
