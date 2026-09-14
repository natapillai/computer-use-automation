import type { OutputSpec } from '../core/capability/schema.js';
import { resolveBundle } from '../core/locator/resolve.js';
import type { LocatorBundle } from '../core/locator/schema.js';
import { parseMoney } from '../core/outcome/money.js';
import type { TypedValue } from '../core/outcome/result.js';
import { findNodeByRef } from '../core/surfaceModel/tree.js';
import type { Observation, UINode } from '../core/surfaceModel/types.js';
import type { GuardedSurface } from '../surface/guardedSurface.js';

// text is what later templates see for this output. For money it is the raw text.
export type Extraction =
  | { readonly ok: true; readonly value: TypedValue; readonly text: string }
  | { readonly ok: false; readonly reason: string };

// Reads one output from the observation its step ended on. A reason names the output and
// its target and never the text on the page, because an unparseable balance is still a
// member's balance.
export async function extractOutput(spec: OutputSpec, target: LocatorBundle, observation: Observation, surface: GuardedSurface): Promise<Extraction> {
  const resolution = await resolveBundle(target, (strategy, framePath) => surface.match(strategy, framePath));
  const node = resolution.ok ? findNodeByRef(observation.root, resolution.ref) : null;
  if (node === null) return { ok: false, reason: `${target.describedAs} did not resolve, so ${spec.name} could not be read.` };

  const text = attributeOf(node, spec.source.attribute);
  if (text === null) return { ok: false, reason: `${spec.name} reads ${spec.source.attribute}, which the accessibility tree does not carry.` };

  const parse = spec.source.parse;
  if (parse?.kind === 'money') {
    const money = parseMoney(text, parse.currency);
    return money.ok
      ? { ok: true, value: money.value, text: money.value.raw }
      : { ok: false, reason: `${spec.name} could not be read as ${parse.currency} money from ${target.describedAs}.` };
  }
  if (parse?.kind === 'number') {
    const number = Number(text.replace(/,/g, '').trim());
    return text.trim() !== '' && Number.isFinite(number)
      ? { ok: true, value: { type: 'number', value: number }, text: String(number) }
      : { ok: false, reason: `${spec.name} could not be read as a number from ${target.describedAs}.` };
  }
  return { ok: true, value: { type: 'string', value: text }, text };
}

// A field is read by its value and anything else by its name, as conditions are.
function attributeOf(node: UINode, attribute: OutputSpec['source']['attribute']): string | null {
  switch (attribute) {
    case 'text':
      return node.value ?? node.name;
    case 'value':
      return node.value ?? null;
    case 'ariaValue':
    case 'href':
    case 'checked':
      return null;
  }
}
