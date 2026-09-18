import type { LocatorBundle } from '../core/locator/schema.js';

// What a person did while they held the session, see docs/ESCALATION.md section 6. The record
// answers what was touched, where and when. There is no value field, not even a redacted one
// with a length, because capturing what an operator typed would put a copy of regulated data in
// evidence for no gain.

export interface HumanActionRecord {
  readonly at: string;
  readonly kind: 'click' | 'press' | 'navigate';
  // Derived from the element the click actually landed on, exactly like a model driven one, so
  // ADR 0013 holds for human actions too. Null when the hit test found nothing to name.
  readonly target: { readonly describedAs: string; readonly bundle: LocatorBundle } | null;
  readonly url: string;
  readonly key?: string;
  // Where a person sent a frame. It can carry a member id, so it is redacted at the sink like
  // every other written string.
  readonly path?: string;
  readonly framePath?: readonly string[];
}

// Why a navigation a person asked for did not happen. A refusal says which rule stopped it,
// because a console that silently does nothing is the defect this whole port exists to fix.
export type HumanNavigation =
  | { readonly ok: true; readonly record: HumanActionRecord }
  | { readonly ok: false; readonly reason: 'topLevel' | 'noFrame' | 'notAllowed' | 'failed'; readonly detail: string };

// The port the operator API forwards through. The web implementation hit tests and dispatches
// into the same page the automation was using.
export interface HumanInputPort {
  click(point: { readonly x: number; readonly y: number }): Promise<HumanActionRecord>;
  press(key: string): Promise<HumanActionRecord>;
  // A path inside a named frame. Clicking cannot reach a page nothing links to, and a person
  // who cannot reach it cannot unblock the run, so the console needs an address bar. It is
  // bounded by the same allowlist every request is, and it never moves the top window, because
  // the frameset is the session and replacing it would end the run the person is rescuing.
  navigate(request: { readonly path: string; readonly framePath: readonly string[] }): Promise<HumanNavigation>;
}
