import type { LocatorBundle } from '../core/locator/schema.js';

// What a person did while they held the session, see docs/ESCALATION.md section 6. The record
// answers what was touched, where and when. There is no value field, not even a redacted one
// with a length, because capturing what an operator typed would put a copy of regulated data in
// evidence for no gain.

export interface HumanActionRecord {
  readonly at: string;
  readonly kind: 'click' | 'press';
  // Derived from the element the click actually landed on, exactly like a model driven one, so
  // ADR 0013 holds for human actions too. Null when the hit test found nothing to name.
  readonly target: { readonly describedAs: string; readonly bundle: LocatorBundle } | null;
  readonly url: string;
  readonly key?: string;
}

// The port the operator API forwards through. The web implementation hit tests and dispatches
// into the same page the automation was using.
export interface HumanInputPort {
  click(point: { readonly x: number; readonly y: number }): Promise<HumanActionRecord>;
  press(key: string): Promise<HumanActionRecord>;
}
