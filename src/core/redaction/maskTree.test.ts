import { describe, expect, it } from 'vitest';
import profileJson from '../../../profiles/meridian-core.json' with { type: 'json' };
import { meridianScript } from '../../../tests/fixtures/surface/meridianScreens.js';
import { AppProfile, sensitiveFields } from '../policy/profile.js';
import { walkNodes } from '../surfaceModel/tree.js';
import type { Observation, UINode } from '../surfaceModel/types.js';
import { maskTree } from './maskTree.js';
import { createRedactor } from './redactor.js';

const profile = AppProfile.parse(profileJson);
const redactor = createRedactor({ neverPersist: [], redactPatterns: [{ name: 'cardNumber', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', flags: 'g', validator: 'luhn' }] });

function detail(): Observation {
  const screen = meridianScript().screens['detail'];
  if (screen === undefined) throw new Error('The scripted detail screen is missing.');
  return screen;
}

function shape(root: UINode): unknown[] {
  return [...walkNodes(root)].map((node) => [node.ref, node.role, node.box, node.framePath]);
}

describe('maskTree', () => {
  it('hides the cells the profile marks sensitive and writes a supplied value as its template', () => {
    const observation = detail();
    const text = JSON.stringify(maskTree(observation.root, { sensitive: sensitiveFields(profile, observation), inputs: { memberId: '10001' }, redactor }));

    for (const literal of ['10001', 'Test Member One', '4111 1111 1111 1111', '$4,250.75']) expect(text).not.toContain(literal);
    expect(text).toContain('{{inputs.memberId}}');
    expect(text).toContain('[redacted:pii]');
  });

  it('keeps the shape of the tree, every ref, role, box and frame path', () => {
    const observation = detail();

    expect(shape(maskTree(observation.root, { sensitive: sensitiveFields(profile, observation), inputs: { memberId: '10001' }, redactor }))).toEqual(shape(observation.root));
  });

  it('catches a card number the profile knows nothing about through the redactor', () => {
    const root: UINode = { ...detail().root, name: 'Card 4111 1111 1111 1111' };

    expect(JSON.stringify(maskTree(root, { sensitive: new Map(), inputs: {}, redactor }))).not.toContain('4111');
  });
});
