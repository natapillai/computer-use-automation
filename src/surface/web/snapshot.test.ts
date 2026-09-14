import { describe, expect, it } from 'vitest';
import { findNodeByRef, walkNodes } from '../../core/surfaceModel/tree.js';
import type { UINode } from '../../core/surfaceModel/types.js';
import { iframeRefsOf, toUINodeTree } from './snapshot.js';

// The shapes Playwright 1.63.0 returns from page.ariaSnapshotJSON in ai mode with
// boxes, written by hand from what it returned for MERIDIAN Core.
const at = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const snapshot = [
  {
    role: 'generic',
    active: true,
    ref: 'e1',
    box: at(0, 0, 1024, 700),
    children: [
      {
        role: 'iframe',
        ref: 'e4',
        box: at(0, 27, 170, 673),
        children: [{ role: 'link', name: 'Member Search', ref: 'f2e8', cursor: 'pointer', url: '/servicing/search', box: at(6, 29, 110, 19) }],
      },
      {
        role: 'iframe',
        active: true,
        ref: 'e5',
        box: at(171, 27, 853, 673),
        children: [
          {
            role: 'generic',
            active: true,
            ref: 'f3e1',
            box: at(8, 8, 837, 654),
            children: [
              { role: 'heading', name: 'Member Search', level: 1, ref: 'f3e2', box: at(8, 8, 837, 17) },
              { role: 'cell', name: 'Member ID:', ref: 'f3e11', box: at(8, 33, 99, 27) },
              { role: 'textbox', active: true, ref: 'f3e13', text: '10001', box: at(110, 36, 121, 21) },
              { role: 'cell', name: 'Search', ref: 'f3e24', cursor: 'pointer', box: at(110, 90, 76, 27) },
              { role: 'checkbox', name: 'Joint', checked: true, disabled: true, ref: 'f3e30', box: at(8, 130, 13, 13) },
              { role: 'paragraph', text: 'Invalid user name or password.', ref: 'f3e31', box: at(8, 150, 300, 16) },
              { role: 'cell', ref: 'f3e32', box: at(8, 170, 120, 20), children: ['Balance ', { role: 'strong', name: 'due', ref: 'f3e33', box: at(60, 172, 30, 16) }] },
            ],
          },
        ],
      },
      { role: 'iframe', ref: 'e9', box: at(0, 0, 10, 10), children: [{ role: 'button', name: 'Go', ref: 'f4e1' }] },
    ],
  },
];

const frameNames = new Map([
  ['e4', 'nav'],
  ['e5', 'content'],
]);

function node(tree: UINode, ref: string): UINode {
  const found = findNodeByRef(tree, ref);
  if (found === null) throw new Error(`No node ${ref} in the converted tree.`);
  return found;
}

describe('toUINodeTree', () => {
  const tree = toUINodeTree(snapshot, frameNames);

  it('lists every iframe ref so the driver can ask each frame its name', () => {
    expect(iframeRefsOf(snapshot)).toEqual(['e4', 'e5', 'e9']);
  });

  it('keeps refs, roles, names and boxes in document order', () => {
    expect(tree.ref).toBe('e1');
    expect([...walkNodes(tree)].map((n) => n.ref)).toEqual([
      'e1', 'e4', 'f2e8', 'e5', 'f3e1', 'f3e2', 'f3e11', 'f3e13', 'f3e24', 'f3e30', 'f3e31', 'f3e32', 'f3e32~0', 'f3e33', 'e9', 'f4e1',
    ]);
    expect(node(tree, 'f3e2')).toMatchObject({ role: 'heading', name: 'Member Search', box: at(8, 8, 837, 17) });
  });

  it('puts the children of an iframe in its frame, and the iframe itself in its parent', () => {
    expect(node(tree, 'e5').framePath).toEqual([]);
    expect(node(tree, 'f3e2').framePath).toEqual(['content']);
    expect(node(tree, 'f2e8').framePath).toEqual(['nav']);
    expect(node(tree, 'f4e1').framePath).toEqual(['#e9']);
  });

  it('reads text as the value of a field and as the name of anything else', () => {
    expect(node(tree, 'f3e13')).toMatchObject({ name: '', value: '10001' });
    expect(node(tree, 'f3e31').name).toBe('Invalid user name or password.');
    expect(node(tree, 'f3e31').value).toBeUndefined();
  });

  it('hints clickable for a pointer cursor on a node with no interactive role only', () => {
    expect(node(tree, 'f3e24').clickableHint).toBe(true);
    expect(node(tree, 'f2e8').clickableHint).toBe(false);
  });

  it('marks focus on the deepest active node only', () => {
    expect(node(tree, 'f3e13').state.focused).toBe(true);
    expect(['e1', 'e5', 'f3e1'].map((ref) => node(tree, ref).state.focused)).toEqual([false, false, false]);
  });

  it('carries disabled and checked', () => {
    expect(node(tree, 'f3e30').state).toMatchObject({ disabled: true, checked: true, visible: true });
  });

  it('turns a text fragment into a text node inside its parent box with a ref no snapshot produces', () => {
    expect(node(tree, 'f3e32~0')).toMatchObject({ role: 'text', name: 'Balance ', box: at(8, 170, 120, 20), framePath: ['content'] });
  });

  it('treats a node without a box as not visible', () => {
    expect(node(tree, 'f4e1').state.visible).toBe(false);
  });

  it('refuses something that is not a snapshot', () => {
    expect(() => toUINodeTree(42, frameNames)).toThrow(TypeError);
  });
});
