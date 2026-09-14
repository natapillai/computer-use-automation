import { describe, expect, it } from 'vitest';
import { box, observationOf, uiNode } from '../../../tests/fixtures/surface/nodes.js';
import { fingerprint } from './fingerprint.js';
import type { Observation } from './types.js';

function field(ref: string, x: number, value?: string, contentUrl?: string): Observation {
  return observationOf([uiNode(ref, 'textbox', '', box(x, 36, 121, 21), value === undefined ? {} : { value })], contentUrl);
}

describe('fingerprint', () => {
  it('ignores refs and boxes, which change without the page changing', () => {
    expect(fingerprint(field('f3e13', 110))).toBe(fingerprint(field('f3e99', 140)));
  });

  it('changes when a value changes', () => {
    expect(fingerprint(field('f3e13', 110, '10001'))).not.toBe(fingerprint(field('f3e13', 110)));
  });

  it('changes when a frame navigates', () => {
    expect(fingerprint(field('f3e13', 110, undefined, 'http://localhost:4010/member/10001'))).not.toBe(fingerprint(field('f3e13', 110)));
  });

  it('changes when a node appears', () => {
    expect(fingerprint(observationOf([]))).not.toBe(fingerprint(field('f3e13', 110)));
  });
});
