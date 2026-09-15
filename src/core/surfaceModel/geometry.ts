import type { Box } from './types.js';

// Geometry is only ever a relation between two nodes in one frame, never a coordinate to
// click. See ADR 0012.

// Adjacent cells in a table with collapsed borders share a border pixel, so two columns
// that merely touch are not one above the other. The S2-T01 spike found the Account column
// counted as below the Balance header by a single pixel.
const SHARED_BORDER_PX = 2;

export function overlapsHorizontally(a: Box, b: Box): boolean {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > SHARED_BORDER_PX;
}

export function sameRow(a: Box, b: Box): boolean {
  const within = (y: number, box: Box): boolean => y >= box.y && y <= box.y + box.height;
  return within(a.y + a.height / 2, b) || within(b.y + b.height / 2, a);
}

export function sameFramePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}
