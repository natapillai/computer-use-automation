import { describe, expect, it } from 'vitest';
import type { LocatorBundle } from '../locator/schema.js';
import type { ConditionMatcher } from '../outcome/condition.js';
import { templateBundle, templateCondition } from './templateCondition.js';

const values = { inputs: { memberId: '10001', odd: 'a.b(1)' }, outputs: {}, env: {} };

const bundle: LocatorBundle = {
  framePath: ['content'],
  strategies: [
    { kind: 'role-name', role: 'link', name: '{{inputs.memberId}}', exact: true, confidence: 0.9 },
    { kind: 'text', text: 'Member {{inputs.memberId}}', exact: false, confidence: 0.7 },
    { kind: 'label', text: '{{inputs.memberId}}', confidence: 0.6 },
    {
      kind: 'anchor-relative',
      anchor: { kind: 'text', text: '{{inputs.memberId}}', exact: true, confidence: 0.8 },
      relation: 'rightOf',
      role: 'cell',
      confidence: 0.5,
    },
  ],
  matchPolicy: 'unique',
  describedAs: 'Result row link for the member',
};

function byName(name: string): LocatorBundle {
  return { ...bundle, strategies: [{ kind: 'role-name', role: 'cell', name, exact: true, confidence: 0.9 }] };
}

describe('templateBundle', () => {
  it('substitutes inputs into every text bearing field, including the anchor', () => {
    const templated = templateBundle(bundle, values, []);

    expect(templated.ok).toBe(true);
    if (!templated.ok) return;
    expect(templated.value.strategies).toEqual([
      { kind: 'role-name', role: 'link', name: '10001', exact: true, confidence: 0.9 },
      { kind: 'text', text: 'Member 10001', exact: false, confidence: 0.7 },
      { kind: 'label', text: '10001', confidence: 0.6 },
      {
        kind: 'anchor-relative',
        anchor: { kind: 'text', text: '10001', exact: true, confidence: 0.8 },
        relation: 'rightOf',
        role: 'cell',
        confidence: 0.5,
      },
    ]);
    expect(templated.value.describedAs).toBe('Result row link for the member');
  });

  it('reports every unresolved reference instead of handing back a half resolved bundle', () => {
    const broken: LocatorBundle = {
      ...bundle,
      strategies: [
        { kind: 'role-name', role: 'link', name: '{{inputs.missing}}', exact: true, confidence: 0.9 },
        { kind: 'text', text: '{{outputs.balance}}', exact: true, confidence: 0.7 },
      ],
    };

    expect(templateBundle(broken, values, [])).toEqual({ ok: false, failure: 'UnresolvedReference', references: ['inputs.missing', 'outputs.balance'] });
  });
});

describe('templateCondition', () => {
  it('escapes regular expression characters in a pattern, and only in a pattern', () => {
    const condition: ConditionMatcher = {
      kind: 'all',
      of: [
        { kind: 'textMatches', target: byName('{{inputs.odd}}'), pattern: '^{{inputs.odd}}$' },
        { kind: 'not', of: { kind: 'urlMatches', pattern: '/member/{{inputs.odd}}' } },
      ],
    };

    const templated = templateCondition(condition, values, []);

    expect(templated).toEqual({
      ok: true,
      value: {
        kind: 'all',
        of: [
          { kind: 'textMatches', target: byName('a.b(1)'), pattern: '^a\\.b\\(1\\)$' },
          { kind: 'not', of: { kind: 'urlMatches', pattern: '/member/a\\.b\\(1\\)' } },
        ],
      },
    });
    if (!templated.ok || templated.value.kind !== 'all' || templated.value.of[0]?.kind !== 'textMatches') return;
    const pattern = new RegExp(templated.value.of[0].pattern);
    expect(pattern.test('a.b(1)')).toBe(true);
    expect(pattern.test('aXb(1)')).toBe(false);
  });

  it('leaves a condition with no references as it was, through any', () => {
    const condition: ConditionMatcher = { kind: 'any', of: [{ kind: 'dialogPresent' }, { kind: 'httpStatus', codes: [503] }] };

    expect(templateCondition(condition, values, [])).toEqual({ ok: true, value: condition });
  });

  it('fails the whole condition when a nested target has an unresolved reference', () => {
    const condition: ConditionMatcher = { kind: 'any', of: [{ kind: 'elementPresent', target: byName('{{inputs.missing}}') }] };

    expect(templateCondition(condition, values, [])).toEqual({ ok: false, failure: 'UnresolvedReference', references: ['inputs.missing'] });
  });
});
