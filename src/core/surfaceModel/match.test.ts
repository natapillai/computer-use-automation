import { describe, expect, it } from 'vitest';
import { box, hidden, observationOf, uiNode } from '../../../tests/fixtures/surface/nodes.js';
import type { LocatorStrategy } from '../locator/schema.js';
import { matchStrategy } from './match.js';

const navLink = uiNode('nav1', 'link', 'Member Search', box(4, 30, 100, 14), { framePath: ['nav'] });
const heading = uiNode('h1', 'heading', 'Member Search', box(8, 8, 600, 18));

const memberInput = uiNode('n3', 'textbox', '', box(92, 40, 100, 20), { derivedLabel: 'Member  ID:' });
const memberRow = uiNode('r1', 'row', 'Member  ID:', box(8, 40, 184, 20), {
  children: [uiNode('n2', 'cell', 'Member  ID:', box(8, 40, 80, 20)), uiNode('c1', 'cell', '', box(92, 40, 100, 20), { children: [memberInput] })],
});

const surnameInput = uiNode('n5', 'textbox', '', box(92, 64, 160, 20), { derivedLabel: 'Surname:' });
const surnameRow = uiNode('r2', 'row', 'Surname:', box(8, 64, 244, 20), {
  children: [uiNode('n4', 'cell', 'Surname:', box(8, 64, 80, 20)), uiNode('c2', 'cell', '', box(92, 64, 160, 20), { children: [surnameInput] })],
});

const searchCell = uiNode('n6', 'cell', 'Search', box(92, 90, 60, 20), { clickableHint: true });
const hiddenSearchCell = uiNode('n7', 'cell', 'Search', box(0, 0, 0, 0), { state: hidden });

const savingsRow = uiNode('r3', 'row', 'S01 Savings $4,250.75', box(8, 200, 228, 20), {
  children: [
    uiNode('s1', 'cell', 'S01', box(8, 200, 40, 20)),
    uiNode('s2', 'cell', 'Savings', box(52, 200, 100, 20)),
    uiNode('s3', 'cell', '$4,250.75', box(156, 200, 80, 20)),
  ],
});
const checkingRow = uiNode('r4', 'row', 'C01 Checking $310.20', box(8, 222, 228, 20), {
  children: [
    uiNode('k1', 'cell', 'C01', box(8, 222, 40, 20)),
    uiNode('k2', 'cell', 'Checking', box(52, 222, 100, 20)),
    uiNode('k3', 'cell', '$310.20', box(156, 222, 80, 20)),
  ],
});

const screen = observationOf([navLink, heading, memberRow, surnameRow, searchCell, hiddenSearchCell, savingsRow, checkingRow]);

function match(strategy: LocatorStrategy, framePath: readonly string[] = ['content']): readonly string[] {
  return matchStrategy(screen, strategy, framePath);
}

const confidence = 0.8;

describe('matchStrategy', () => {
  it('matches role and name, exactly after collapsing whitespace or as a case blind substring', () => {
    expect(match({ kind: 'role-name', role: 'cell', name: 'Search', exact: true, confidence })).toEqual(['n6']);
    expect(match({ kind: 'role-name', role: 'heading', name: 'member search', exact: false, confidence })).toEqual(['h1']);
    expect(match({ kind: 'role-name', role: 'cell', name: 'Member ID:', exact: true, confidence })).toEqual(['n2']);
  });

  it('matches text on the innermost node only, so a row named by its cells does not double count', () => {
    expect(match({ kind: 'text', text: 'Member ID:', exact: false, confidence })).toEqual(['n2']);
    expect(match({ kind: 'text', text: 'Member ID:', exact: true, confidence })).toEqual(['n2']);
    expect(match({ kind: 'text', text: 'member id:', exact: true, confidence })).toEqual([]);
    expect(match({ kind: 'text', text: 'Search', exact: false, confidence })).toEqual(['h1', 'n6']);
  });

  it('never matches a hidden node', () => {
    expect(match({ kind: 'text', text: 'Search', exact: true, confidence })).toEqual(['n6']);
  });

  it('scopes every match to the frame path', () => {
    expect(match({ kind: 'role-name', role: 'link', name: 'Member Search', exact: true, confidence })).toEqual([]);
    expect(match({ kind: 'role-name', role: 'link', name: 'Member Search', exact: true, confidence }, ['nav'])).toEqual(['nav1']);
  });

  it('matches a label through the derived label, ignoring case, spacing and a trailing colon', () => {
    expect(match({ kind: 'label', text: 'Member ID', confidence })).toEqual(['n3']);
    expect(match({ kind: 'label', text: 'surname:', confidence })).toEqual(['n5']);
  });

  it('finds the input on the same row as its label and not the one below', () => {
    const anchor = { kind: 'text', text: 'Member ID:', exact: false, confidence } as const;

    expect(match({ kind: 'anchor-relative', anchor, relation: 'sameRow', role: 'textbox', confidence })).toEqual(['n3']);
  });

  it('finds every input below a heading, and only the nearest for firstBelow', () => {
    const anchor = { kind: 'role-name', role: 'heading', name: 'Member Search', exact: true, confidence } as const;

    expect(match({ kind: 'anchor-relative', anchor, relation: 'below', role: 'textbox', confidence })).toEqual(['n3', 'n5']);
    expect(match({ kind: 'anchor-relative', anchor, relation: 'firstBelow', role: 'textbox', confidence })).toEqual(['n3']);
  });

  it('finds the cell right of Savings and not the cell left of it or the row below', () => {
    const anchor = { kind: 'text', text: 'Savings', exact: true, confidence } as const;

    expect(match({ kind: 'anchor-relative', anchor, relation: 'rightOf', role: 'cell', confidence })).toEqual(['s3']);
  });

  it('does not count a neighbouring column that only shares a border pixel as below a header', () => {
    // Boxes Chromium reported for the MERIDIAN accounts table, where collapsed borders
    // make adjacent cells overlap by one pixel.
    const table = observationOf([
      uiNode('hAccount', 'cell', 'Account', box(69, 119, 78, 24)),
      uiNode('hBalance', 'cell', 'Balance', box(146, 119, 99, 24)),
      uiNode('vAccount', 'cell', 'Savings', box(69, 143, 78, 24)),
      uiNode('vBalance', 'cell', '$4,250.75', box(146, 143, 99, 24)),
    ]);
    const anchor = { kind: 'text', text: 'Balance', exact: true, confidence } as const;

    expect(matchStrategy(table, { kind: 'anchor-relative', anchor, relation: 'below', role: 'cell', confidence }, ['content'])).toEqual(['vBalance']);
  });

  it('unions candidates from every anchor, so an ambiguous anchor surfaces as several matches', () => {
    const anchor = { kind: 'text', text: '01', exact: false, confidence } as const;

    expect(match({ kind: 'anchor-relative', anchor, relation: 'rightOf', role: 'cell', confidence })).toEqual(['s2', 's3', 'k2', 'k3']);
  });

  it('matches nothing relative to an anchor that matches nothing', () => {
    const anchor = { kind: 'text', text: 'Account Holder ID:', exact: false, confidence } as const;

    expect(match({ kind: 'anchor-relative', anchor, relation: 'sameRow', role: 'textbox', confidence })).toEqual([]);
  });

  it('answers test-id and structural with no match, because the tree carries no attributes', () => {
    expect(match({ kind: 'test-id', attr: 'data-testid', value: 'search', confidence })).toEqual([]);
    expect(match({ kind: 'structural', path: 'table > tr > td', confidence })).toEqual([]);
  });
});
