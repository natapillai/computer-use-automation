import { describe, expect, it } from 'vitest';
import { box, observationOf, uiNode } from '../../../tests/fixtures/surface/nodes.js';
import { progressHash } from './progressHash.js';
import type { Observation, UINode } from './types.js';

const clock = (time: string, ref = 'c1'): UINode => uiNode(ref, 'cell', `Session active ${time}`, box(488, 3, 530, 19));
const field = (value?: string, ref = 'n3'): UINode => uiNode(ref, 'textbox', '', box(110, 36, 121, 21), value === undefined ? {} : { value });
const link = (name: string): UINode => uiNode('r1', 'link', name, box(15, 158, 44, 19));

function page(children: readonly UINode[], contentUrl?: string): Observation {
  return observationOf(children, contentUrl);
}

describe('progressHash', () => {
  it('stays the same when only static text changes, so a ticking clock is not progress', () => {
    expect(progressHash(page([clock('09:00:00'), field()]))).toBe(progressHash(page([clock('09:00:01'), field()])));
  });

  it('ignores refs and boxes, which change without the page changing', () => {
    expect(progressHash(page([field(undefined, 'n3')]))).toBe(progressHash(page([uiNode('f3e13', 'textbox', '', box(0, 0, 10, 10))])));
  });

  it('changes when a node appears, such as a new result row', () => {
    expect(progressHash(page([field(), link('10001')]))).not.toBe(progressHash(page([field()])));
  });

  it('changes when a field value changes', () => {
    expect(progressHash(page([field('10001')]))).not.toBe(progressHash(page([field()])));
  });

  it('changes when an interactive element is renamed, such as a link to another member', () => {
    expect(progressHash(page([link('10002')]))).not.toBe(progressHash(page([link('10001')])));
  });

  it('changes when a frame navigates', () => {
    expect(progressHash(page([field()], 'http://localhost:4010/member/10001'))).not.toBe(progressHash(page([field()])));
  });
});
