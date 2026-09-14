import type { LocatorStrategy } from '../locator/schema.js';
import type { Box, Observation, UINode } from './types.js';

// Matches one locator strategy against an observation. It is surface agnostic, so the
// fake and the web driver answer the core resolver identically, and a desktop driver
// that produces the same tree gets the same answers.

type AnchorRelative = Extract<LocatorStrategy, { kind: 'anchor-relative' }>;

interface Placed {
  readonly node: UINode;
  readonly ancestors: ReadonlySet<string>;
}

// Roles a label can name. A cell reading Member ID: is text, not a labelled control.
const LABELLED_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'spinbutton', 'slider', 'switch']);

// One pixel of slack, because layout engines round box edges.
const EDGE_TOLERANCE = 1;

export function matchStrategy(observation: Observation, strategy: LocatorStrategy, framePath: readonly string[]): readonly string[] {
  return matchPlaced(placeNodes(observation.root, framePath), strategy).map((placed) => placed.node.ref);
}

// Visible nodes in the frame, in document order, each with the refs above it.
function placeNodes(root: UINode, framePath: readonly string[]): readonly Placed[] {
  const placed: Placed[] = [];
  const visit = (node: UINode, ancestors: ReadonlySet<string>): void => {
    if (node.state.visible && sameFrame(node.framePath, framePath)) placed.push({ node, ancestors });
    const below = new Set(ancestors).add(node.ref);
    for (const child of node.children) visit(child, below);
  };
  visit(root, new Set());
  return placed;
}

function matchPlaced(placed: readonly Placed[], strategy: LocatorStrategy): readonly Placed[] {
  switch (strategy.kind) {
    case 'role-name':
      return placed.filter((p) => p.node.role === strategy.role && textMatches(p.node.name, strategy.name, strategy.exact));
    case 'label':
      return placed.filter((p) => {
        const label = labelOf(p.node);
        return label !== null && labelKey(label) === labelKey(strategy.text);
      });
    case 'text':
      return innermost(placed.filter((p) => textMatches(p.node.name, strategy.text, strategy.exact)));
    case 'anchor-relative':
      return relative(placed, strategy);
    case 'test-id':
    case 'structural':
      // The tree carries no attributes or markup paths. A driver that can answer these
      // from its own document does so outside this function.
      return [];
  }
}

// Every anchor contributes its candidates, so an ambiguous anchor surfaces as several
// matches and the unique policy rejects it, rather than one anchor being picked silently.
function relative(placed: readonly Placed[], strategy: AnchorRelative): readonly Placed[] {
  const anchors = matchPlaced(placed, strategy.anchor);
  const candidates = placed.filter((p) => strategy.role === undefined || p.node.role === strategy.role);
  const chosen = new Set<string>();

  for (const anchor of anchors) {
    const related = candidates.filter(
      (candidate) =>
        candidate.node.ref !== anchor.node.ref &&
        !anchor.ancestors.has(candidate.node.ref) &&
        !candidate.ancestors.has(anchor.node.ref) &&
        relates(strategy.relation, anchor.node.box, candidate.node.box),
    );
    for (const candidate of strategy.relation === 'firstBelow' ? nearestBelow(related) : related) chosen.add(candidate.node.ref);
  }

  return placed.filter((p) => chosen.has(p.node.ref));
}

function relates(relation: AnchorRelative['relation'], anchor: Box, candidate: Box): boolean {
  switch (relation) {
    case 'sameRow':
      return sameRow(anchor, candidate);
    case 'rightOf':
      return sameRow(anchor, candidate) && candidate.x >= anchor.x + anchor.width - EDGE_TOLERANCE;
    case 'below':
    case 'firstBelow':
      return candidate.y >= anchor.y + anchor.height - EDGE_TOLERANCE && overlapsHorizontally(anchor, candidate);
  }
}

function nearestBelow(related: readonly Placed[]): readonly Placed[] {
  const top = Math.min(...related.map((p) => p.node.box.y));
  return related.filter((p) => p.node.box.y <= top + EDGE_TOLERANCE);
}

function sameRow(a: Box, b: Box): boolean {
  const within = (y: number, box: Box): boolean => y >= box.y && y <= box.y + box.height;
  return within(a.y + a.height / 2, b) || within(b.y + b.height / 2, a);
}

function overlapsHorizontally(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width;
}

// A row or a cell is often named by the text of its descendants. Only the deepest
// match counts, the way a person points at the words and not at the table.
function innermost(matches: readonly Placed[]): readonly Placed[] {
  return matches.filter((p) => !matches.some((other) => other !== p && other.ancestors.has(p.node.ref)));
}

function labelOf(node: UINode): string | null {
  if (node.derivedLabel !== undefined && normalize(node.derivedLabel) !== '') return node.derivedLabel;
  if (LABELLED_ROLES.has(node.role) && normalize(node.name) !== '') return node.name;
  return null;
}

function labelKey(text: string): string {
  return normalize(text).replace(/:$/, '').trim().toLowerCase();
}

function textMatches(actual: string, wanted: string, exact: boolean): boolean {
  const a = normalize(actual);
  const b = normalize(wanted);
  return exact ? a === b : a.toLowerCase().includes(b.toLowerCase());
}

// Legacy labels carry doubled spaces and non breaking spaces. Neither is meaning.
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sameFrame(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}
