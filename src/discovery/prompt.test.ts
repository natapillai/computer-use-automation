import { describe, expect, it } from 'vitest';
import { buildGoal, systemPrompt, SYSTEM_PROMPT } from './prompt.js';

describe('systemPrompt', () => {
  it('says nothing about declaring a write when the run may not write', () => {
    expect(systemPrompt()).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).not.toContain('submits');
  });

  it('tells a run that may write to declare the one action that submits, and only that one', () => {
    const writing = systemPrompt({ writes: true });

    expect(writing).toContain('submits');
    expect(writing).toContain('approve');
    // Everything the read only prompt says still applies.
    expect(writing.startsWith(SYSTEM_PROMPT)).toBe(true);
  });
});

describe('buildGoal', () => {
  it('keeps a templated goal and lists the inputs the model can type by name', () => {
    const goal = buildGoal('Find the savings balance of the member whose member ID is {{inputs.memberId}}.', { memberId: '10001' });

    expect(goal).toEqual({
      ok: true,
      text: 'Goal: Find the savings balance of the member whose member ID is {{inputs.memberId}}.\nInputs you can type: memberId.',
    });
  });

  it('refuses a goal that carries an input value, so no member id reaches the model', () => {
    expect(buildGoal('Find the savings balance of member 10001.', { memberId: '10001' })).toEqual({ ok: false, failure: 'GoalCarriesInput', inputs: ['memberId'] });
  });

  it('refuses a goal that references an input nobody supplied', () => {
    expect(buildGoal('Open account {{inputs.accountId}}.', { memberId: '10001' })).toEqual({
      ok: false,
      failure: 'GoalReferencesUnknownInput',
      references: ['accountId'],
    });
  });
});

describe('SYSTEM_PROMPT', () => {
  it('tells the model to act by ref with one tool per turn and never names a selector', () => {
    expect(SYSTEM_PROMPT).toContain('ref');
    expect(SYSTEM_PROMPT).toContain('one tool call per turn');
    expect(SYSTEM_PROMPT).not.toMatch(/selector|xpath|css/i);
  });
});
