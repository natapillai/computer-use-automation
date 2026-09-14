import { overlapsHorizontally, sameFramePath } from './geometry.js';
import { INTERACTIVE_ROLES, LABELLED_ROLES } from './roles.js';
import type { UINode } from './types.js';

// A legacy form labels its inputs with a sibling table cell, so the input has no
// accessible name. This attaches the nearest text by layout, first to the left in the
// same row band, then stacked just above. See ADR 0012 and failure F4 in S0-T03.

// Chromium can report a label cell overlapping the input beside it by a pixel or two.
const EDGE_TOLERANCE = 2;

// A stacked label sits directly above its field. Anything further is a heading or another row.
const MAX_STACKED_GAP = 24;

export function deriveLabels(root: UINode): UINode {
  const candidates = labelCandidates(root);

  const visit = (node: UINode): UINode => {
    const children = node.children.map(visit);
    const needsLabel = LABELLED_ROLES.has(node.role) && node.name.trim() === '' && node.derivedLabel === undefined;
    const derivedLabel = needsLabel ? nearestLabel(node, candidates) : null;
    if (derivedLabel === null && children.every((child, i) => child === node.children[i])) return node;
    return derivedLabel === null ? { ...node, children } : { ...node, derivedLabel, children };
  };

  return visit(root);
}

// Visible, named, not interactive, and with no named node below it, so a row named by
// its cells never outranks the cell holding the words.
function labelCandidates(root: UINode): readonly UINode[] {
  const found: UINode[] = [];
  const visit = (node: UINode): boolean => {
    let namedBelow = false;
    for (const child of node.children) namedBelow = visit(child) || namedBelow;
    const named = node.name.trim() !== '';
    if (named && !namedBelow && node.state.visible && !INTERACTIVE_ROLES.has(node.role)) found.push(node);
    return named || namedBelow;
  };
  visit(root);
  return found;
}

function nearestLabel(input: UINode, candidates: readonly UINode[]): string | null {
  const inFrame = candidates.filter((candidate) => sameFramePath(candidate.framePath, input.framePath));
  const centre = input.box.y + input.box.height / 2;

  const left = inFrame
    .filter((c) => centre >= c.box.y && centre <= c.box.y + c.box.height && c.box.x + c.box.width <= input.box.x + EDGE_TOLERANCE)
    .map((c) => ({ label: c.name, gap: input.box.x - (c.box.x + c.box.width) }))
    .sort((a, b) => a.gap - b.gap);
  if (left[0] !== undefined) return left[0].label;

  const above = inFrame
    .map((c) => ({ candidate: c, gap: input.box.y - (c.box.y + c.box.height) }))
    .filter(({ candidate, gap }) => gap >= -EDGE_TOLERANCE && gap <= MAX_STACKED_GAP && overlapsHorizontally(candidate.box, input.box))
    .sort((a, b) => a.gap - b.gap);
  return above[0]?.candidate.name ?? null;
}
