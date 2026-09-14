import type { UINode } from './types.js';

export function findNodeByRef(root: UINode, ref: string): UINode | null {
  if (root.ref === ref) return root;
  for (const child of root.children) {
    const found = findNodeByRef(child, ref);
    if (found !== null) return found;
  }
  return null;
}

export function* walkNodes(root: UINode): Generator<UINode> {
  yield root;
  for (const child of root.children) {
    yield* walkNodes(child);
  }
}
