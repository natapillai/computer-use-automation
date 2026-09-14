import { describe, expect, it } from 'vitest';
import type { StrategyMatcher } from '../locator/resolve.js';
import type { LocatorBundle } from '../locator/schema.js';
import type { Observation, UINode } from '../surfaceModel/types.js';
import type { ConditionMatcher } from './condition.js';
import { evaluateCondition, type EvaluationContext } from './evaluate.js';

const box = { x: 0, y: 0, width: 10, height: 10 };
const state = { disabled: false, visible: true, focused: false };

function node(ref: string, role: string, name: string, extra: Partial<UINode> = {}): UINode {
  return { ref, role, name, state, framePath: ['content'], box, clickableHint: false, children: [], ...extra };
}

const memberField = node('n2', 'textbox', '', { value: '10001' });
const bannerCell = node('n3', 'cell', 'No records found');

const observation: Observation = {
  root: node('n1', 'generic', '', { children: [memberField, bannerCell] }),
  frames: [{ framePath: ['content'], url: 'http://localhost:4010/servicing/search', lastStatus: 200 }],
  dialogOpen: false,
};

function byText(describedAs: string, text: string): LocatorBundle {
  return { framePath: ['content'], strategies: [{ kind: 'text', text, exact: true, confidence: 0.8 }], matchPolicy: 'unique', describedAs };
}

function byRole(describedAs: string, role: string): LocatorBundle {
  return {
    framePath: ['content'],
    strategies: [{ kind: 'role-name', role, name: '', exact: false, confidence: 0.8 }],
    matchPolicy: 'unique',
    describedAs,
  };
}

// A small matcher over the fixture tree, just enough to exercise the evaluator.
const match: StrategyMatcher = async (strategy) => {
  const nodes = [observation.root, memberField, bannerCell];
  if (strategy.kind === 'text') return nodes.filter((n) => n.name === strategy.text).map((n) => n.ref);
  if (strategy.kind === 'role-name') return nodes.filter((n) => n.role === strategy.role).map((n) => n.ref);
  return [];
};

function context(resolvable: readonly string[] = [], override: Partial<Observation> = {}): EvaluationContext {
  return {
    observation: { ...observation, ...override },
    match,
    outputResolvable: async (name) => resolvable.includes(name),
  };
}

const banner = byText('No records banner', 'No records found');
const memberInput = byRole('Member ID input', 'textbox');
const resultRow = byText('Result row', 'Test Member One');

async function holds(condition: ConditionMatcher, ctx: EvaluationContext = context()): Promise<boolean> {
  return (await evaluateCondition(condition, ctx)).holds;
}

describe('evaluateCondition', () => {
  it('holds elementPresent only when the target resolves', async () => {
    expect(await holds({ kind: 'elementPresent', target: banner })).toBe(true);
    expect(await holds({ kind: 'elementPresent', target: resultRow })).toBe(false);
  });

  it('matches textMatches against the value of a field and the name of anything else', async () => {
    expect(await holds({ kind: 'textMatches', target: memberInput, pattern: '^10001$' })).toBe(true);
    expect(await holds({ kind: 'textMatches', target: banner, pattern: '^No records' })).toBe(true);
    expect(await holds({ kind: 'textMatches', target: memberInput, pattern: '^10002$' })).toBe(false);
  });

  it('does not hold textMatches when its target does not resolve', async () => {
    expect(await holds({ kind: 'textMatches', target: resultRow, pattern: '.*' })).toBe(false);
  });

  it('matches urlMatches against the frame urls', async () => {
    expect(await holds({ kind: 'urlMatches', pattern: '/servicing/search$' })).toBe(true);
    expect(await holds({ kind: 'urlMatches', pattern: '/member/' })).toBe(false);
  });

  it('matches httpStatus against the last status of each frame', async () => {
    expect(await holds({ kind: 'httpStatus', codes: [200] })).toBe(true);
    expect(await holds({ kind: 'httpStatus', codes: [502, 503] })).toBe(false);
  });

  it('reflects whether a dialog is open', async () => {
    expect(await holds({ kind: 'dialogPresent' })).toBe(false);
    expect(await holds({ kind: 'dialogPresent' }, context([], { dialogOpen: true }))).toBe(true);
  });

  it('asks whether an output can be read for outputResolvable', async () => {
    expect(await holds({ kind: 'outputResolvable', outputName: 'savingsBalance' }, context(['savingsBalance']))).toBe(true);
    expect(await holds({ kind: 'outputResolvable', outputName: 'savingsBalance' })).toBe(false);
  });

  it('combines children with all, any and not', async () => {
    const present: ConditionMatcher = { kind: 'elementPresent', target: banner };
    const absent: ConditionMatcher = { kind: 'elementPresent', target: resultRow };

    expect(await holds({ kind: 'all', of: [present, { kind: 'httpStatus', codes: [200] }] })).toBe(true);
    expect(await holds({ kind: 'all', of: [present, absent] })).toBe(false);
    expect(await holds({ kind: 'any', of: [absent, present] })).toBe(true);
    expect(await holds({ kind: 'any', of: [absent] })).toBe(false);
    expect(await holds({ kind: 'not', of: absent })).toBe(true);
  });

  it('says what it observed without echoing page text', async () => {
    const missing = await evaluateCondition({ kind: 'elementPresent', target: resultRow }, context());
    const mismatch = await evaluateCondition({ kind: 'textMatches', target: memberInput, pattern: '^10002$' }, context());

    expect(missing.detail).toBe('Result row did not resolve.');
    expect(mismatch.detail).toBe('Member ID input did not match the expected pattern.');
    expect(mismatch.detail).not.toContain('10001');
  });
});
