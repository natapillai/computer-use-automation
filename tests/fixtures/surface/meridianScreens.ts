import type { Observation, UINode } from '../../../src/core/surfaceModel/types.js';
import type { FakeScript, FakeTransition } from '../../../src/surface/fake/fakeSurfaceDriver.js';
import { box, uiNode } from './nodes.js';

// MERIDIAN Core as the fake driver sees it, with the geometry Chromium reported for the
// real pages. Options switch in the variants the executor tests need.

export interface MeridianScriptOptions {
  readonly memberLabel?: string;
  readonly searchLeadsTo?: 'results' | 'noRecords' | 'wrongPage' | 'nowhere' | 'loginRedirect';
  readonly memberId?: string;
  readonly balance?: string;
  readonly duplicateSearchButton?: boolean;
  // Where the results and no records screens say the content frame is, and the status it
  // loaded with, so a profile condition can hold on the same screen as a step condition.
  readonly resultsPath?: string;
  readonly resultsStatus?: number;
}

const ORIGIN = 'http://localhost:4010';

function screen(children: readonly UINode[], contentPath: string, contentStatus = 200): Observation {
  return {
    root: uiNode('e1', 'generic', '', box(0, 0, 1024, 700), {
      framePath: [],
      children: [
        uiNode('e4', 'iframe', '', box(0, 27, 170, 673), {
          framePath: [],
          children: [uiNode('f2e8', 'link', 'Member Search', box(6, 29, 110, 19), { framePath: ['nav'] })],
        }),
        uiNode('e5', 'iframe', '', box(171, 27, 853, 673), { framePath: [], children }),
      ],
    }),
    frames: [
      { framePath: [], url: `${ORIGIN}/servicing`, lastStatus: 200 },
      { framePath: ['nav'], url: `${ORIGIN}/servicing/nav`, lastStatus: 200 },
      { framePath: ['content'], url: `${ORIGIN}${contentPath}`, lastStatus: contentStatus },
    ],
    dialogOpen: false,
  };
}

const blank: Observation = {
  root: uiNode('e1', 'generic', '', box(0, 0, 1024, 700), { framePath: [] }),
  frames: [{ framePath: [], url: 'about:blank', lastStatus: null }],
  dialogOpen: false,
};

function searchForm(memberLabel: string, duplicateSearchButton: boolean): readonly UINode[] {
  return [
    uiNode('h1', 'heading', 'Member Search', box(8, 8, 837, 17)),
    uiNode('n2', 'cell', memberLabel, box(8, 33, 99, 27)),
    uiNode('n3', 'textbox', '', box(110, 36, 121, 21), { derivedLabel: memberLabel }),
    uiNode('n4', 'cell', 'Surname:', box(8, 60, 99, 27)),
    uiNode('n5', 'textbox', '', box(110, 63, 177, 21), { derivedLabel: 'Surname:' }),
    uiNode('n6', 'cell', 'Search', box(110, 90, 76, 27), { clickableHint: true }),
    ...(duplicateSearchButton ? [uiNode('n7', 'cell', 'Search', box(200, 90, 76, 27), { clickableHint: true })] : []),
  ];
}

export function meridianScript(options: MeridianScriptOptions = {}): FakeScript {
  const memberId = options.memberId ?? '10001';
  const form = searchForm(options.memberLabel ?? 'Member ID:', options.duplicateSearchButton ?? false);
  const leadsTo = options.searchLeadsTo ?? 'results';
  const resultsPath = options.resultsPath ?? '/servicing/search';
  const resultsStatus = options.resultsStatus ?? 200;

  const transitions: FakeTransition[] = [
    { from: 'blank', on: { kind: 'navigate', path: '/servicing' }, to: 'search' },
    { from: 'search', on: { kind: 'navigate', path: '/servicing/search' }, to: 'search' },
    { from: 'results', on: { kind: 'click', ref: 'r1' }, to: 'detail' },
  ];
  if (leadsTo !== 'nowhere') transitions.push({ from: 'search', on: { kind: 'click', ref: 'n6' }, to: leadsTo });

  return {
    start: 'blank',
    screens: {
      blank,
      search: screen(form, '/servicing/search'),
      results: screen(
        [
          ...form,
          uiNode('t1', 'cell', 'Member No', box(9, 132, 105, 24)),
          uiNode('t2', 'cell', 'Name', box(114, 132, 138, 24)),
          uiNode('r1', 'link', memberId, box(15, 158, 44, 19)),
          uiNode('t3', 'cell', 'Test Member One', box(114, 156, 138, 24)),
        ],
        resultsPath,
        resultsStatus,
      ),
      noRecords: screen([...form, uiNode('m1', 'cell', 'No records found.', box(8, 131, 120, 20))], resultsPath, resultsStatus),
      wrongPage: screen([uiNode('h1', 'heading', 'Session Notice', box(8, 8, 837, 17))], '/servicing/search'),
      loginRedirect: screen(
        [
          uiNode('lh', 'heading', 'MERIDIAN Core', box(24, 24, 300, 17)),
          uiNode('lu', 'textbox', 'User name:', box(120, 60, 160, 21)),
          uiNode('lp', 'textbox', 'Password:', box(120, 88, 160, 21)),
        ],
        '/auth/login',
      ),
      detail: screen(
        [
          uiNode('h1', 'heading', 'Member Detail', box(8, 8, 837, 17)),
          uiNode('d1', 'cell', 'Member No:', box(8, 33, 96, 25)),
          uiNode('d2', 'cell', memberId, box(104, 33, 161, 25)),
          uiNode('d3', 'cell', 'Name:', box(8, 58, 96, 25)),
          uiNode('d4', 'cell', 'Test Member One', box(104, 58, 161, 25)),
          uiNode('d5', 'cell', 'Card:', box(8, 83, 96, 25)),
          uiNode('d6', 'cell', '4111 1111 1111 1111', box(104, 83, 161, 25)),
          uiNode('t4', 'cell', 'Suffix', box(9, 119, 60, 24)),
          uiNode('t5', 'cell', 'Account', box(69, 119, 78, 24)),
          uiNode('t6', 'cell', 'Balance', box(146, 119, 99, 24)),
          uiNode('s1', 'cell', 'S01', box(9, 143, 60, 24)),
          uiNode('s2', 'cell', 'Savings', box(69, 143, 78, 24)),
          uiNode('s3', 'cell', options.balance ?? '$4,250.75', box(146, 143, 99, 24)),
        ],
        `/member/${memberId}`,
      ),
    },
    transitions,
  };
}
