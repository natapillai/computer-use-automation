import { createHash } from 'node:crypto';
import { sensitiveFields, type AppProfile } from '../core/policy/profile.js';
import type { Redactor } from '../core/redaction/redactor.js';
import { INTERACTIVE_ROLES, VALUE_ROLES } from '../core/surfaceModel/roles.js';
import type { Observation, UINode } from '../core/surfaceModel/types.js';

// What the model is shown, see docs/SAFETY.md section 4. The observation is pruned to what a
// person could act on or read, member data is hidden before any text exists, and a value the
// caller supplied appears only as its template. The format and the redaction order are the
// ones the S2-T01 spike proved against a real model, kept byte for byte so its recorded
// cassette still drives the loop, per ADR 0017.

export interface ObservationContext {
  readonly profile: AppProfile;
  readonly redactor: Redactor;
  readonly inputs: Readonly<Record<string, string>>;
}

export interface ObservationForModel {
  readonly text: string;
  readonly hash: string;
}

// Money the profile field map did not cover. A prompt only safety net, not an evidence rule.
const MONEY = /\(?\$?\d[\d,]*\.\d{2}\)?(?:\s?[A-Z]{3}\b)?/g;

// Every masked field reads [redacted:pii] whatever its sensitivity. The model needs to know a
// value is hidden, not how sensitive it is, and one marker keeps recorded observations stable.
const HIDDEN = '[redacted:pii]';

export function buildObservation(observation: Observation, context: ObservationContext): ObservationForModel {
  const masked = maskSensitiveFields(observation, context);
  const known = Object.entries(context.inputs)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => ({ value, replacement: `{{inputs.${name}}}` }));
  const text = context.redactor.text(renderObservation(masked), { known }).replace(MONEY, '[redacted:money]');
  return { text, hash: createHash('sha256').update(text).digest('hex').slice(0, 16) };
}

// Provenance comes before the field map. A sensitive cell whose text is exactly a supplied
// value shows its template, because the model has to recognise the member it was asked about.
function maskSensitiveFields(observation: Observation, context: ObservationContext): Observation {
  const sensitive = sensitiveFields(context.profile, observation);

  const templateFor = (text: string): string | null => {
    const collapsed = collapse(text);
    for (const [name, value] of Object.entries(context.inputs)) if (value !== '' && collapsed === value) return `{{inputs.${name}}}`;
    return null;
  };

  const mask = (node: UINode, inside: boolean): UINode => {
    const hidden = inside || sensitive.has(node.ref);
    const name = !hidden || node.name.trim() === '' ? node.name : (templateFor(node.name) ?? HIDDEN);
    return { ...node, name, children: node.children.map((child) => mask(child, hidden)) };
  };
  return { ...observation, root: mask(observation.root, false) };
}

export function renderObservation(observation: Observation): string {
  const included = new Set<string>();
  const mark = (node: UINode): boolean => {
    let namedBelow = false;
    for (const child of node.children) namedBelow = mark(child) || namedBelow;
    const named = node.name.trim() !== '';
    const operable = (INTERACTIVE_ROLES.has(node.role) && node.role !== 'iframe') || node.clickableHint;
    if (node.state.visible && (operable || (named && !namedBelow))) included.add(node.ref);
    return named || namedBelow;
  };
  mark(observation.root);

  const sections = new Map<string, string[]>();
  const visit = (node: UINode): void => {
    if (included.has(node.ref)) {
      const key = JSON.stringify(node.framePath);
      const lines = sections.get(key) ?? [];
      lines.push(lineFor(node));
      sections.set(key, lines);
    }
    for (const child of node.children) visit(child);
  };
  visit(observation.root);

  const out: string[] = [];
  for (const [key, lines] of sections) {
    const frame = observation.frames.find((candidate) => JSON.stringify(candidate.framePath) === key);
    const framePath = frame?.framePath ?? [];
    const where = frame === undefined ? '' : ` at ${pathOf(frame.url)}`;
    out.push(`frame ${framePath.length === 0 ? 'top' : framePath.join(' > ')}${where}, framePath ${key}`);
    for (const line of lines) out.push(`  ${line}`);
  }
  if (observation.dialogOpen) out.push('A dialog is open.');
  return out.join('\n');
}

function lineFor(node: UINode): string {
  const parts = [`[${node.ref}]`, node.role];
  if (node.name.trim() !== '') parts.push(JSON.stringify(collapse(node.name)));
  if (node.derivedLabel !== undefined) parts.push(`label=${JSON.stringify(collapse(node.derivedLabel))}`);
  if (VALUE_ROLES.has(node.role)) parts.push(`value=${JSON.stringify(node.value ?? '')}`);
  if (node.clickableHint) parts.push('clickable');
  if (node.state.disabled) parts.push('disabled');
  if (node.state.checked !== undefined) parts.push(node.state.checked ? 'checked' : 'unchecked');
  return parts.join(' ');
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
