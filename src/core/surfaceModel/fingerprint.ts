import type { Observation, UINode } from './types.js';

// What could tell two observations apart for a person looking at the page. Refs are
// reissued on every snapshot and boxes move with layout, so neither counts. The executor
// compares fingerprints to tell a step that changed nothing from one that changed the
// page into the wrong state.
export function fingerprint(observation: Observation): string {
  return JSON.stringify({
    frames: observation.frames.map((frame) => [frame.framePath, frame.url, frame.lastStatus]),
    dialogOpen: observation.dialogOpen,
    root: shape(observation.root),
  });
}

function shape(node: UINode): unknown {
  return [
    node.role,
    node.name,
    node.value ?? null,
    node.derivedLabel ?? null,
    node.state.disabled,
    node.state.visible,
    node.state.focused,
    node.state.checked ?? null,
    node.framePath,
    node.children.map(shape),
  ];
}
