import type { Box } from './types.js';

// Geometry is only ever a relation between two nodes in one frame, never a coordinate to
// click. See ADR 0012.

export function overlapsHorizontally(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width;
}

export function sameRow(a: Box, b: Box): boolean {
  const within = (y: number, box: Box): boolean => y >= box.y && y <= box.y + box.height;
  return within(a.y + a.height / 2, b) || within(b.y + b.height / 2, a);
}

export function sameFramePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}
