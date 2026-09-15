import { INTERACTIVE_ROLES } from './roles.js';
import type { Observation, UINode } from './types.js';

// What NoProgress compares, see docs/ESCALATION.md section 3. Structure, roles, the names of
// things a person operates, values, states and frame urls, and never the text of a static
// node. A clock ticking in the status frame is therefore not progress, and a newly rendered
// result row is. Refs and boxes are left out, because both change without the page changing.
// The value is a canonical key rather than a digest, so core needs no crypto. A caller that
// logs it can digest it.
export function progressHash(observation: Observation): string {
  return JSON.stringify({
    frames: observation.frames.map((frame) => [frame.framePath, frame.url, frame.lastStatus]),
    dialogOpen: observation.dialogOpen,
    root: shape(observation.root),
  });
}

function shape(node: UINode): unknown {
  const operable = (INTERACTIVE_ROLES.has(node.role) && node.role !== 'iframe') || node.clickableHint;
  return [
    node.role,
    operable ? node.name : '',
    node.value ?? null,
    node.state.disabled,
    node.state.visible,
    node.state.checked ?? null,
    node.framePath,
    node.children.map(shape),
  ];
}
