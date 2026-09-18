import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allowlist, profile, redactor, runFakeDiscovery } from '../../tests/fixtures/discovery/fakeRun.js';
import { meridianScript } from '../../tests/fixtures/surface/meridianScreens.js';
import { createControlTokens } from '../control/controlToken.js';
import { Capability } from '../core/capability/schema.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { replay } from '../replay/executor.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver } from '../surface/fake/fakeSurfaceDriver.js';
import { createGuardedSurface } from '../surface/guardedSurface.js';
import { generalize, type GeneralizeOptions } from './generalizer.js';
import type { RecordedAction } from './recorder.js';
import type { RunTrace } from './trace.js';

const options: GeneralizeOptions = {
  id: 'member.readSavingsBalance',
  name: 'Read member savings balance',
  description: 'Looks up a member by ID and returns the current balance of their primary savings account.',
  app: { appId: 'meridian-core', vendor: 'meridian', entryPath: '/servicing' },
  inputs: [{ name: 'memberId', type: 'string', required: true, sensitivity: 'pii', description: 'Institution member number', constraints: { pattern: '^[0-9]{5,10}$' } }],
  inputValues: { memberId: '10001' },
  recordedAt: '2026-09-15T09:00:00.000Z',
  model: 'claude-sonnet-5',
  profile,
  redactor,
};

async function happyTrace(): Promise<RunTrace> {
  return (await runFakeDiscovery()).trace;
}

function withActions(trace: RunTrace, edit: (actions: RecordedAction[]) => RecordedAction[]): RunTrace {
  return { ...trace, actions: edit([...trace.actions]) };
}

async function generalized(trace: RunTrace): Promise<Capability> {
  const result = await generalize(trace, options);
  if (!result.ok) throw new Error(`The generalizer failed with ${result.failure}. ${result.detail}`);
  return result.capability;
}

describe('generalize', () => {
  it('turns a discovery run into a valid draft artifact shaped like the worked example', async () => {
    const capability = await generalized(await happyTrace());

    expect(Capability.safeParse(capability).success).toBe(true);
    expect(capability).toMatchObject({
      schemaVersion: '1.0.0',
      id: 'member.readSavingsBalance',
      version: '1.0.0',
      app: { entryPath: '/servicing' },
      outcomes: [],
      lifecycle: { status: 'draft' },
      provenance: { discoveryRunId: 'run_000001', model: 'claude-sonnet-5', redactionApplied: true },
    });
    expect(capability.steps.map((step) => [step.index, step.action.kind, step.value ?? null, step.postcondition.condition.kind])).toEqual([
      [0, 'fill', '{{inputs.memberId}}', 'textMatches'],
      [1, 'click', null, 'elementPresent'],
      [2, 'click', null, 'elementPresent'],
    ]);
    expect(capability.successCondition.condition).toMatchObject({ kind: 'all', of: [{ kind: 'elementPresent' }, { kind: 'outputResolvable', outputName: 'savingsBalance' }] });
  });

  it('carries a declared write into the step, which is never retried and never idempotent', async () => {
    const trace = withActions(await happyTrace(), (actions) => actions.map((action) => (action.index === 1 ? { ...action, submits: true } : action)));

    const capability = await generalized(trace);

    expect(capability.steps.map((step) => [step.effect, step.idempotent, step.retry.attempts])).toEqual([
      ['read', true, 2],
      ['write', false, 0],
      ['read', false, 0],
    ]);
  });

  it('refuses a run a person had to finish, and accepts one they only approved', async () => {
    const trace = await happyTrace();
    const handback = (reason: 'ModelRequested' | 'PolicyConfirmation'): RunTrace => ({
      ...trace,
      events: [...trace.events, { t: 'handback', at: '2026-09-15T09:00:01.000Z', interventionId: 'int_000001', reason, approved: true }],
    });

    const completed = await generalize(handback('ModelRequested'), options);
    const approved = await generalize(handback('PolicyConfirmation'), options);

    expect(completed).toMatchObject({ ok: false, failure: 'HumanCompleted' });
    expect(approved.ok).toBe(true);
  });

  it('produces exactly the reviewed draft for the fixture trace', async () => {
    const expected: unknown = JSON.parse(readFileSync(new URL('../../tests/fixtures/discovery/expectedDraft.json', import.meta.url), 'utf8'));

    expect(await generalized(await happyTrace())).toEqual(expected);
  });

  it('replays on the scripted app to the balance the discovery run extracted', async () => {
    const capability = await generalized(await happyTrace());
    const clock = createTestClock('2026-09-15T10:00:00.000Z');
    const tokens = createControlTokens('sess_replay', createSequentialIds());
    const driver = createFakeSurfaceDriver({ sessionId: 'sess_replay', control: tokens, script: meridianScript(), clock });
    const surface = createGuardedSurface({
      driver,
      policy: { allowlist, phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants: createGrantLedger() },
      runId: 'run_replay',
      baseUrl: 'http://localhost:4010',
    });

    const result = await replay(capability, { memberId: '10001' }, { surface, control: tokens.issue('automation'), clock, runId: 'run_replay', profile });

    expect(result).toMatchObject({ status: 'success', outputs: { savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD' } } });
  });

  describe('prune', () => {
    it('drops a failed action and an action that changed nothing', async () => {
      const trace = withActions(await happyTrace(), (actions) => {
        const [fill, ...rest] = actions;
        if (fill === undefined) throw new Error('The trace has no actions.');
        const failed: RecordedAction = { ...fill, tool: 'click', value: undefined, ok: false, changed: false };
        const noOp: RecordedAction = { ...fill, tool: 'click', value: undefined, ok: true, changed: false };
        return [failed, noOp, fill, ...rest].map((action, index) => ({ ...action, index }));
      });

      expect((await generalized(trace)).steps.map((step) => step.action.kind)).toEqual(['fill', 'click', 'click']);
    });
  });

  describe('parameterise', () => {
    it('writes a literal input value in a step value or locator text as its template', async () => {
      const trace = withActions(await happyTrace(), (actions) =>
        actions.map((action) =>
          action.tool === 'fill'
            ? { ...action, value: '10001' }
            : action.bundle !== null && action.bundle.describedAs.includes('{{inputs.memberId}}')
              ? { ...action, bundle: JSON.parse(JSON.stringify(action.bundle).split('{{inputs.memberId}}').join('10001')) as typeof action.bundle }
              : action,
        ),
      );

      const text = JSON.stringify(await generalized(trace));
      expect(text).not.toContain('10001');
      expect(text).toContain('"value":"{{inputs.memberId}}"');
    });
  });

  describe('canonicalise', () => {
    it('stores a recorded navigate to a member path as a template', async () => {
      const trace = withActions(await happyTrace(), (actions) => {
        const navigate: RecordedAction = { index: 0, tool: 'navigate', framePath: ['content'], bundle: null, dropped: [], submits: false, path: '/member/10001', ok: true, changed: true };
        return [...actions.slice(0, 2), navigate, ...actions.slice(2)].map((action, index) => ({ ...action, index }));
      });

      const navigateStep = (await generalized(trace)).steps.find((step) => step.action.kind === 'navigate');
      expect(navigateStep?.action).toEqual({ kind: 'navigate', path: '/member/{{inputs.memberId}}', framePath: ['content'] });
    });
  });

  describe('infer checkpoints', () => {
    it('gives a fill a check on its own value and every other step the element the next step needs, never a url alone', async () => {
      const capability = await generalized(await happyTrace());
      const [fill, search, open] = capability.steps;

      expect(fill?.postcondition.condition).toMatchObject({ kind: 'textMatches', pattern: '^{{inputs.memberId}}$', target: fill?.target });
      expect(search?.postcondition.condition).toMatchObject({ kind: 'elementPresent', target: open?.target });
      expect(open?.postcondition.condition).toMatchObject({ kind: 'elementPresent', target: capability.outputs[0]?.source.target });
      expect(capability.steps.every((step) => step.postcondition.condition.kind !== 'urlMatches')).toBe(true);
    });

    it('never retries a click, because nothing recorded shows it is safe to repeat', async () => {
      const capability = await generalized(await happyTrace());

      for (const step of capability.steps.filter((candidate) => candidate.action.kind === 'click')) {
        expect(step).toMatchObject({ effect: 'read', idempotent: false, retry: { attempts: 0 } });
      }
    });
  });

  describe('type outputs', () => {
    it('types an extracted balance as USD money that is pii, read after the step that showed it', async () => {
      const capability = await generalized(await happyTrace());

      expect(capability.outputs).toEqual([
        expect.objectContaining({
          name: 'savingsBalance',
          type: 'money',
          sensitivity: 'pii',
          required: true,
          source: expect.objectContaining({ stepId: capability.steps[2]?.id, attribute: 'text', parse: { kind: 'money', currency: 'USD' } }),
        }),
      ]);
    });

    it('types text that is not money as a string that keeps the sensitivity of the cell it came from', async () => {
      const { trace } = await runFakeDiscovery(undefined, { balance: 'N/A' });

      expect((await generalized(trace)).outputs[0]).toMatchObject({ type: 'string', sensitivity: 'pii' });
    });
  });

  it('refuses to emit an artifact carrying member data it cannot turn into a template', async () => {
    const trace = withActions(await happyTrace(), (actions) =>
      actions.map((action) => (action.bundle === null ? action : { ...action, bundle: { ...action.bundle, describedAs: 'cell 4111 1111 1111 1111' } })),
    );

    expect(await generalize(trace, options)).toMatchObject({ ok: false, failure: 'SensitiveLiteral' });
  });

  it('fails the run when the synthesized success condition does not hold on the observation the run ended on', async () => {
    const trace = await happyTrace();
    const search = meridianScript().screens['search'];
    if (search === undefined) throw new Error('The scripted search screen is missing.');

    expect(await generalize({ ...trace, finalObservation: search }, options)).toMatchObject({ ok: false, failure: 'SuccessNotObserved' });
  });
});
