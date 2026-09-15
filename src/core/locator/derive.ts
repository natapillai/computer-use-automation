import { resolveTemplate } from '../capability/resolveTemplate.js';
import type { FieldSensitivity } from '../policy/profile.js';
import { overlapsHorizontally, sameFramePath, sameRow } from '../surfaceModel/geometry.js';
import { matchStrategy } from '../surfaceModel/match.js';
import { INTERACTIVE_ROLES, LABELLED_ROLES } from '../surfaceModel/roles.js';
import { findNodeByRef, walkNodes } from '../surfaceModel/tree.js';
import type { Observation, UINode } from '../surfaceModel/types.js';
import type { LocatorBundle, LocatorStrategy } from './schema.js';

// Derives a locator bundle from the real element at the moment it is acted on, per ADR 0013.
// Every candidate strategy is resolved against the same observation and kept only when it
// matches exactly that element. Text equal to a supplied input becomes its template. Text
// that shows member data is dropped, and the drop record never repeats it. Nothing here reads
// anything the model wrote, only the observation and a ref.

export interface DerivationContext {
  readonly inputs: Readonly<Record<string, string>>;
  readonly sensitive: ReadonlyMap<string, FieldSensitivity>;
  readonly redacts: (text: string) => boolean;
}

export interface DroppedStrategy {
  readonly strategy: LocatorStrategy;
  readonly reason: 'ambiguous' | 'missed' | 'sensitive';
}

export type Derivation =
  | { readonly ok: true; readonly bundle: LocatorBundle; readonly dropped: readonly DroppedStrategy[] }
  | { readonly ok: false; readonly failure: 'NoUniqueStrategy'; readonly dropped: readonly DroppedStrategy[] };

// A candidate and the nodes whose text it uses, so a sensitive source can be judged.
interface Candidate {
  readonly strategy: LocatorStrategy;
  readonly sources: readonly UINode[];
}

const REDACTED = '[redacted:pii]';

export function deriveBundle(observation: Observation, ref: string, context: DerivationContext): Derivation {
  const target = findNodeByRef(observation.root, ref);
  if (target === null) return { ok: false, failure: 'NoUniqueStrategy', dropped: [] };

  const template = (text: string): string => templated(collapse(text), context.inputs);
  const leftAnchor = nearestLeftText(observation, target, context);
  const heading = nearestHeadingAbove(observation, target);
  const labelText = target.derivedLabel ?? (LABELLED_ROLES.has(target.role) && target.name.trim() !== '' ? target.name : undefined);

  const candidates: Candidate[] = [];
  if (target.name.trim() !== '') {
    candidates.push({ strategy: { kind: 'role-name', role: target.role, name: template(target.name), exact: true, confidence: 0.9 }, sources: [target] });
  }
  if (labelText !== undefined) {
    candidates.push({ strategy: { kind: 'label', text: template(labelText), confidence: 0.85 }, sources: [] });
  }
  if (target.derivedLabel !== undefined) {
    candidates.push({
      strategy: { kind: 'anchor-relative', anchor: { kind: 'text', text: template(target.derivedLabel), exact: true, confidence: 0.8 }, relation: 'sameRow', role: target.role, confidence: 0.8 },
      sources: [],
    });
  }
  if (leftAnchor !== null) {
    candidates.push({
      strategy: { kind: 'anchor-relative', anchor: { kind: 'text', text: template(leftAnchor.name), exact: true, confidence: 0.75 }, relation: 'rightOf', role: target.role, confidence: 0.75 },
      sources: [leftAnchor],
    });
  }
  if (target.name.trim() !== '') {
    candidates.push({ strategy: { kind: 'text', text: template(target.name), exact: true, confidence: 0.7 }, sources: [target] });
  }
  if (heading !== null) {
    candidates.push({
      strategy: {
        kind: 'anchor-relative',
        anchor: { kind: 'role-name', role: 'heading', name: template(heading.name), exact: true, confidence: 0.6 },
        relation: 'firstBelow',
        role: target.role,
        confidence: 0.6,
      },
      sources: [heading],
    });
  }

  const kept: LocatorStrategy[] = [];
  const dropped: DroppedStrategy[] = [];
  for (const candidate of candidates) {
    if (showsMemberData(candidate, context)) {
      dropped.push({ strategy: withTexts(candidate.strategy, () => REDACTED), reason: 'sensitive' });
      continue;
    }
    const matches = matchStrategy(observation, withTexts(candidate.strategy, (text) => resolved(text, context.inputs)), target.framePath);
    if (matches.length === 1 && matches[0] === ref) {
      if (!kept.some((strategy) => JSON.stringify(strategy) === JSON.stringify(candidate.strategy))) kept.push(candidate.strategy);
    } else {
      dropped.push({ strategy: candidate.strategy, reason: matches.length > 1 ? 'ambiguous' : 'missed' });
    }
  }

  if (kept.length === 0) return { ok: false, failure: 'NoUniqueStrategy', dropped };
  return {
    ok: true,
    bundle: {
      framePath: [...target.framePath],
      strategies: kept.sort((a, b) => b.confidence - a.confidence),
      matchPolicy: 'unique',
      describedAs: describe(target, leftAnchor, context),
    },
    dropped,
  };
}

// Text shows member data when it trips the redactor or comes from a sensitive node, unless
// it is entirely an input template, which is how a member id is allowed to appear.
function showsMemberData(candidate: Candidate, context: DerivationContext): boolean {
  const texts = textsOf(candidate.strategy);
  const allTemplates = texts.every((text) => /^\{\{inputs\.[A-Za-z][A-Za-z0-9_]*\}\}$/.test(text));
  if (allTemplates) return false;
  if (texts.some((text) => context.redacts(text))) return true;
  return candidate.sources.some((node) => context.sensitive.has(node.ref));
}

function describe(target: UINode, leftAnchor: UINode | null, context: DerivationContext): string {
  const name = templated(collapse(target.name), context.inputs);
  const nameIsSafe = name !== '' && !context.sensitive.has(target.ref) && !context.redacts(name);
  if (target.derivedLabel !== undefined) return `${target.role} ${templated(collapse(target.derivedLabel), context.inputs)}`;
  if (nameIsSafe || /^\{\{inputs\.[A-Za-z][A-Za-z0-9_]*\}\}$/.test(name)) return `${target.role} ${name}`;
  if (leftAnchor !== null) return `${target.role} right of ${collapse(leftAnchor.name)}`;
  return target.role;
}

// The nearest static text to the left in the same row band and frame, which is not itself
// member data. What a person reads as the label of a value cell.
function nearestLeftText(observation: Observation, target: UINode, context: DerivationContext): UINode | null {
  const candidates = staticTexts(observation, target).filter(
    (node) => !context.sensitive.has(node.ref) && !context.redacts(node.name) && sameRow(node.box, target.box) && node.box.x + node.box.width <= target.box.x + 2,
  );
  return candidates.sort((a, b) => target.box.x - (a.box.x + a.box.width) - (target.box.x - (b.box.x + b.box.width)))[0] ?? null;
}

function nearestHeadingAbove(observation: Observation, target: UINode): UINode | null {
  const headings = [...walkNodes(observation.root)].filter(
    (node) =>
      node.role === 'heading' &&
      node.ref !== target.ref &&
      node.name.trim() !== '' &&
      node.state.visible &&
      sameFramePath(node.framePath, target.framePath) &&
      node.box.y + node.box.height <= target.box.y + 1 &&
      overlapsHorizontally(node.box, target.box),
  );
  return headings.sort((a, b) => b.box.y - a.box.y)[0] ?? null;
}

// Named, visible, not interactive, and with no named node below it, in the target's frame.
function staticTexts(observation: Observation, target: UINode): UINode[] {
  const found: UINode[] = [];
  const visit = (node: UINode): boolean => {
    let namedBelow = false;
    for (const child of node.children) namedBelow = visit(child) || namedBelow;
    const named = node.name.trim() !== '';
    if (named && !namedBelow && node.ref !== target.ref && node.state.visible && !INTERACTIVE_ROLES.has(node.role) && sameFramePath(node.framePath, target.framePath)) {
      found.push(node);
    }
    return named || namedBelow;
  };
  visit(observation.root);
  return found;
}

function templated(text: string, inputs: Readonly<Record<string, string>>): string {
  let out = text;
  for (const [name, value] of Object.entries(inputs)) {
    if (value === '') continue;
    out = out.replace(new RegExp(`(?<!\\w)${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'g'), `{{inputs.${name}}}`);
  }
  return out;
}

function resolved(text: string, inputs: Readonly<Record<string, string>>): string {
  const resolution = resolveTemplate(text, { inputs, outputs: {}, env: {} }, []);
  return resolution.ok ? resolution.text : text;
}

function textsOf(strategy: LocatorStrategy): string[] {
  switch (strategy.kind) {
    case 'role-name':
      return [strategy.name];
    case 'label':
    case 'text':
      return [strategy.text];
    case 'anchor-relative':
      return textsOf(strategy.anchor);
    case 'test-id':
      return [strategy.value];
    case 'structural':
      return [strategy.path];
  }
}

function withTexts(strategy: LocatorStrategy, map: (text: string) => string): LocatorStrategy {
  switch (strategy.kind) {
    case 'role-name':
      return { ...strategy, name: map(strategy.name) };
    case 'label':
    case 'text':
      return { ...strategy, text: map(strategy.text) };
    case 'anchor-relative': {
      const anchor = strategy.anchor;
      const mapped = anchor.kind === 'role-name' ? { ...anchor, name: map(anchor.name) } : { ...anchor, text: map(anchor.text) };
      return { ...strategy, anchor: mapped };
    }
    case 'test-id':
      return { ...strategy, value: map(strategy.value) };
    case 'structural':
      return { ...strategy, path: map(strategy.path) };
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
