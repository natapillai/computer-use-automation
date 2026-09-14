import type { Box, NodeState, Observation, UINode } from '../../../src/core/surfaceModel/types.js';

export const visible: NodeState = { disabled: false, visible: true, focused: false };
export const hidden: NodeState = { disabled: false, visible: false, focused: false };
export const disabled: NodeState = { disabled: true, visible: true, focused: false };

export function box(x: number, y: number, width: number, height: number): Box {
  return { x, y, width, height };
}

// A node in the content frame unless the extra fields say otherwise.
export function uiNode(ref: string, role: string, name: string, at: Box, extra: Partial<UINode> = {}): UINode {
  return { ref, role, name, state: visible, framePath: ['content'], box: at, clickableHint: false, children: [], ...extra };
}

export function observationOf(children: readonly UINode[], contentUrl = 'http://localhost:4010/servicing/search'): Observation {
  return {
    root: uiNode('root', 'document', '', box(0, 0, 1000, 800), { framePath: [], children }),
    frames: [
      { framePath: [], url: 'http://localhost:4010/servicing', lastStatus: 200 },
      { framePath: ['content'], url: contentUrl, lastStatus: 200 },
    ],
    dialogOpen: false,
  };
}
