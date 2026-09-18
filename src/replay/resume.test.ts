import { describe, expect, it } from 'vitest';
import { readSavingsBalanceFixture } from '../../tests/fixtures/capabilities/readSavingsBalance.js';
import { meridianScript, type MeridianScriptOptions } from '../../tests/fixtures/surface/meridianScreens.js';
import { Capability, type CapabilityInput, type Step } from '../core/capability/schema.js';
import { matchStrategy } from '../core/surfaceModel/match.js';
import type { Observation } from '../core/surfaceModel/types.js';
import { revalidate, type Resumption } from './resume.js';

// The ladder of docs/ESCALATION.md section 7, one test per rung. The page after a release is
// whatever the person left behind, so every rung is decided by looking at it.

const values = { inputs: { memberId: '10001' }, outputs: {}, env: {} };

function screen(name: string, options: MeridianScriptOptions = {}): Observation {
  const found = meridianScript({ memberId: '10001', ...options }).screens[name];
  if (found === undefined) throw new Error(`The scripted app has no ${name} screen.`);
  return found;
}

function stepOf(id: string, capability: Capability = Capability.parse(readSavingsBalanceFixture())): Step {
  const step = capability.steps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`The fixture has no step ${id}.`);
  return step;
}

async function check(observation: Observation, step: Step, extras: { approved?: boolean; capability?: CapabilityInput; resolvable?: boolean } = {}): Promise<Resumption> {
  const capability = Capability.parse(extras.capability ?? readSavingsBalanceFixture());
  return revalidate({
    capability,
    step,
    observation,
    match: async (strategy, framePath) => matchStrategy(observation, strategy, framePath),
    outputResolvable: async () => extras.resolvable ?? false,
    values,
    allowedEnv: [],
    approved: extras.approved ?? false,
  });
}

describe('revalidate', () => {
  it('reports success when the person simply finished the task', async () => {
    expect(await check(screen('detail'), stepOf('submitSearch'), { resolvable: true })).toEqual({ kind: 'success' });
  });

  it('reports a declared outcome when the page now shows one', async () => {
    expect(await check(screen('noRecords'), stepOf('submitSearch'))).toEqual({ kind: 'outcome', code: 'MEMBER_NOT_FOUND' });
  });

  it('advances when the person left the page where the step was trying to get to', async () => {
    expect(await check(screen('results'), stepOf('submitSearch'))).toEqual({ kind: 'satisfiedByHuman' });
  });

  it('performs the approved action itself when the release carried an approval', async () => {
    expect(await check(screen('search'), stepOf('submitSearch'), { approved: true })).toEqual({ kind: 'approved' });
  });

  it('retries a step whose precondition holds again', async () => {
    const fixture = readSavingsBalanceFixture();
    const withPrecondition: CapabilityInput = {
      ...fixture,
      steps: fixture.steps.map((step) =>
        step.id === 'submitSearch' ? { ...step, precondition: { description: 'The search form is present', condition: { kind: 'elementPresent', target: step.target } } } : step,
      ),
    };
    const capability = Capability.parse(withPrecondition);

    expect(await check(screen('search'), stepOf('submitSearch', capability), { capability: withPrecondition })).toEqual({ kind: 'retry' });
  });

  it('retries a step that declares itself repeatable when it has no precondition to check', async () => {
    expect(await check(screen('search'), stepOf('fillMemberId'))).toEqual({ kind: 'retry' });
  });

  it('hands the session straight back when nothing says the step can be repeated safely', async () => {
    const resumption = await check(screen('search'), stepOf('submitSearch'));

    expect(resumption.kind).toBe('escalate');
    expect(resumption.kind === 'escalate' && resumption.detail).toContain('submitSearch');
  });

  it('hands back rather than retrying when a declared precondition does not hold', async () => {
    const fixture = readSavingsBalanceFixture();
    const elsewhere: CapabilityInput = {
      ...fixture,
      steps: fixture.steps.map((step) =>
        step.id === 'submitSearch'
          ? {
              ...step,
              precondition: {
                description: 'The member detail screen is open',
                condition: { kind: 'textMatches', target: { framePath: ['content'], strategies: [{ kind: 'text', text: 'Member Detail', exact: true, confidence: 0.9 }], matchPolicy: 'unique', describedAs: 'the detail heading' }, pattern: 'Member Detail' },
              },
            }
          : step,
      ),
    };
    const capability = Capability.parse(elsewhere);

    expect(await check(screen('search'), stepOf('submitSearch', capability), { capability: elsewhere })).toMatchObject({ kind: 'escalate' });
  });
});
