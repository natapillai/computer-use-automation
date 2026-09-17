import { describe, expect, it } from 'vitest';
import { box, uiNode } from '../../tests/fixtures/surface/nodes.js';
import type { ConditionMatcher } from '../core/outcome/condition.js';
import { matchStrategy } from '../core/surfaceModel/match.js';
import type { Observation } from '../core/surfaceModel/types.js';
import { unclassifiedDialog } from './unclassified.js';

// The one detector that fires in both phases, see docs/ESCALATION.md section 3. A dialog nobody
// declared is the case where the system does not know what to do next, and clicking it to find
// out is exactly what a back office automation must never do.

function screen(dialogOpen: boolean): Observation {
  return {
    root: uiNode('e1', 'generic', '', box(0, 0, 1024, 700), {
      framePath: [],
      children: [uiNode('d1', 'dialog', 'Session notice', box(300, 200, 400, 200), { framePath: [], children: [uiNode('d2', 'text', 'Your session will expire soon.', box(310, 240, 380, 20), { framePath: [] })] })],
    }),
    frames: [{ framePath: [], url: 'http://localhost:4010/servicing', lastStatus: 200 }],
    dialogOpen,
  };
}

const claims: ConditionMatcher = {
  kind: 'textMatches',
  target: { framePath: [], strategies: [{ kind: 'text', text: 'Your session will expire soon.', exact: true, confidence: 0.9 }], matchPolicy: 'unique', describedAs: 'the session notice' },
  pattern: 'expire soon',
};

const claimsNothing: ConditionMatcher = {
  kind: 'textMatches',
  target: { framePath: [], strategies: [{ kind: 'text', text: 'Account restricted', exact: true, confidence: 0.9 }], matchPolicy: 'unique', describedAs: 'the restriction banner' },
  pattern: 'restricted',
};

async function fires(dialogOpen: boolean, conditions: readonly ConditionMatcher[]): Promise<boolean> {
  const observation = screen(dialogOpen);
  return unclassifiedDialog({
    observation,
    conditions,
    match: async (strategy, framePath) => matchStrategy(observation, strategy, framePath),
  });
}

describe('unclassifiedDialog', () => {
  it('fires on a dialog that no rule claims', async () => {
    expect(await fires(true, [claimsNothing])).toBe(true);
    expect(await fires(true, [])).toBe(true);
  });

  it('stays silent when a rule claims the dialog, because then the system knows what it is', async () => {
    expect(await fires(true, [claims])).toBe(false);
    expect(await fires(true, [claimsNothing, claims])).toBe(false);
  });

  it('stays silent when no dialog is open, whatever the rules say', async () => {
    expect(await fires(false, [])).toBe(false);
    expect(await fires(false, [claimsNothing])).toBe(false);
  });
});
