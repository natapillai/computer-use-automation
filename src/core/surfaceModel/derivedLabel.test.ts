import { describe, expect, it } from 'vitest';
import { box, uiNode } from '../../../tests/fixtures/surface/nodes.js';
import { deriveLabels } from './derivedLabel.js';
import { findNodeByRef, walkNodes } from './tree.js';
import type { UINode } from './types.js';

// Coordinates are the ones Chromium reported for the MERIDIAN search form.
function formRow(ref: string, y: number, label: string, inputRef: string, inputWidth: number): UINode {
  return uiNode(ref, 'row', '', box(8, y, 282, 27), {
    children: [
      uiNode(`${ref}-label`, 'cell', label, box(8, y, 99, 27)),
      uiNode(`${ref}-field`, 'cell', '', box(107, y, 183, 27), {
        children: [uiNode(inputRef, 'textbox', '', box(110, y + 3, inputWidth, 21))],
      }),
    ],
  });
}

const searchForm = uiNode('root', 'generic', '', box(0, 0, 853, 673), {
  children: [
    uiNode('h', 'heading', 'Member Search', box(8, 8, 837, 17)),
    uiNode('t', 'table', '', box(8, 33, 282, 87), {
      children: [formRow('r1', 33, 'Member ID:', 'memberId', 121), formRow('r2', 60, 'Surname:', 'surname', 177)],
    }),
  ],
});

function root(children: readonly UINode[]): UINode {
  return uiNode('root', 'generic', '', box(0, 0, 853, 673), { children });
}

function derivedLabelOf(tree: UINode, ref: string): string | undefined {
  return findNodeByRef(deriveLabels(tree), ref)?.derivedLabel;
}

describe('deriveLabels', () => {
  it('binds each input to the nearest text on its left in the same row band', () => {
    expect(derivedLabelOf(searchForm, 'memberId')).toBe('Member ID:');
    expect(derivedLabelOf(searchForm, 'surname')).toBe('Surname:');
  });

  it('labels nothing but unnamed inputs and keeps every node in order', () => {
    const derived = deriveLabels(searchForm);
    const labelled = [...walkNodes(derived)].filter((node) => node.derivedLabel !== undefined).map((node) => node.ref);

    expect(labelled).toEqual(['memberId', 'surname']);
    expect([...walkNodes(derived)].map((node) => node.ref)).toEqual([...walkNodes(searchForm)].map((node) => node.ref));
  });

  it('uses a label stacked just above the input when nothing sits to its left', () => {
    const tree = root([
      uiNode('amountLabel', 'cell', 'Opening amount', box(8, 200, 120, 16)),
      uiNode('amount', 'textbox', '', box(8, 220, 100, 21)),
    ]);

    expect(derivedLabelOf(tree, 'amount')).toBe('Opening amount');
  });

  it('leaves an input that already has an accessible name alone', () => {
    const tree = root([uiNode('l', 'cell', 'User name:', box(8, 40, 80, 20)), uiNode('u', 'textbox', 'User name:', box(92, 40, 100, 20))]);

    expect(derivedLabelOf(tree, 'u')).toBeUndefined();
  });

  it('never takes a label from another frame', () => {
    const tree = root([
      uiNode('navText', 'cell', 'Member ID:', box(8, 400, 80, 20), { framePath: ['nav'] }),
      uiNode('input', 'textbox', '', box(92, 400, 100, 20)),
    ]);

    expect(derivedLabelOf(tree, 'input')).toBeUndefined();
  });

  it('never takes an interactive node as a label', () => {
    const tree = root([uiNode('help', 'link', 'Help', box(8, 400, 40, 20)), uiNode('input', 'textbox', '', box(92, 400, 100, 20))]);

    expect(derivedLabelOf(tree, 'input')).toBeUndefined();
  });
});
