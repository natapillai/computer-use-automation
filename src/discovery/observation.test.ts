import { describe, expect, it } from 'vitest';
import profileJson from '../../profiles/meridian-core.json' with { type: 'json' };
import { box, uiNode } from '../../tests/fixtures/surface/nodes.js';
import { meridianScript } from '../../tests/fixtures/surface/meridianScreens.js';
import { AppProfile } from '../core/policy/profile.js';
import { createRedactor } from '../core/redaction/redactor.js';
import type { Observation } from '../core/surfaceModel/types.js';
import { canariesFromSeed } from '../evidence/scanner.js';
import { buildObservation, renderObservation } from './observation.js';

const profile = AppProfile.parse(profileJson);

// The patterns from policy/allowlist.yaml.
const redactor = createRedactor({
  neverPersist: [],
  redactPatterns: [
    { name: 'ssn', pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: 'g' },
    { name: 'cardNumber', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', flags: 'g', validator: 'luhn' },
    { name: 'email', pattern: '\\b[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}\\b', flags: 'gi' },
    { name: 'phone', pattern: '\\b(?:\\+?1[ .-]?)?\\(?\\d{3}\\)?[ .-]?\\d{3}[ .-]?\\d{4}\\b', flags: 'g' },
    { name: 'accountNumber', pattern: '\\b\\d{9,17}\\b', flags: 'g', contextual: true },
  ],
});

const context = { profile, redactor, inputs: { memberId: '10001' } };

function screen(name: string): Observation {
  const observation = meridianScript().screens[name];
  if (observation === undefined) throw new Error(`The scripted screen ${name} is missing.`);
  return observation;
}

describe('renderObservation', () => {
  it('prunes to interactive and text bearing nodes, grouped by frame in document order, with labels, values and clickable hints', () => {
    expect(renderObservation(screen('search'))).toBe(
      [
        'frame nav at /servicing/nav, framePath ["nav"]',
        '  [f2e8] link "Member Search"',
        'frame content at /servicing/search, framePath ["content"]',
        '  [h1] heading "Member Search"',
        '  [n2] cell "Member ID:"',
        '  [n3] textbox label="Member ID:" value=""',
        '  [n4] cell "Surname:"',
        '  [n5] textbox label="Surname:" value=""',
        '  [n6] cell "Search" clickable',
      ].join('\n'),
    );
  });
});

describe('buildObservation', () => {
  it('hides the member name, card and balances, and shows the member id only as its template', async () => {
    const { text } = buildObservation(screen('detail'), context);

    for (const canary of await canariesFromSeed('apps/target/seed.json')) expect(text).not.toContain(canary);
    expect(text).toContain('[f2e8] link "Member Search"');
    expect(text).toContain('cell "{{inputs.memberId}}"');
    expect(text).toContain('[redacted:pii]');
    expect(text).toContain('frame content at /member/{{inputs.memberId}}');
  });

  it('keeps the headings, labels and account names the model navigates by', () => {
    const { text } = buildObservation(screen('detail'), context);

    expect(text).toContain('heading "Member Detail"');
    expect(text).toContain('cell "Savings"');
    expect(text).toContain('cell "Balance"');
    expect(text).toContain('cell "Name:"');
  });

  it('hides money that the profile field map did not cover', () => {
    const observation = { ...screen('search'), root: uiNode('e1', 'generic', '', box(0, 0, 1024, 700), { framePath: [], children: [uiNode('x1', 'cell', 'Amount due $12.50 today', box(8, 8, 200, 20))] }) };

    expect(buildObservation(observation, context).text).toContain('cell "Amount due [redacted:money] today"');
  });

  it('hashes the text deterministically, and a filled value changes the hash', () => {
    const blankForm = buildObservation(screen('search'), context);
    const filled = screen('search');
    const withValue: Observation = {
      ...filled,
      root: { ...filled.root, children: filled.root.children.map((frame) => ({ ...frame, children: frame.children.map((node) => (node.ref === 'n3' ? { ...node, value: '10001' } : node)) })) },
    };

    expect(buildObservation(screen('search'), context)).toEqual(blankForm);
    expect(blankForm.hash).toMatch(/^[0-9a-f]{16}$/);
    const after = buildObservation(withValue, context);
    expect(after.text).toContain('value="{{inputs.memberId}}"');
    expect(after.hash).not.toBe(blankForm.hash);
  });
});
