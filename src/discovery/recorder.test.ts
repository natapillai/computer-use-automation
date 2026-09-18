import { describe, expect, it } from 'vitest';
import profileJson from '../../profiles/meridian-core.json' with { type: 'json' };
import { meridianScript } from '../../tests/fixtures/surface/meridianScreens.js';
import { AppProfile } from '../core/policy/profile.js';
import { createRedactor } from '../core/redaction/redactor.js';
import type { Observation } from '../core/surfaceModel/types.js';
import { createRecorder } from './recorder.js';

const profile = AppProfile.parse(profileJson);
const redactor = createRedactor({ neverPersist: [], redactPatterns: [] });

function screen(name: string, duplicateSearchButton = false): Observation {
  const observation = meridianScript({ duplicateSearchButton }).screens[name];
  if (observation === undefined) throw new Error(`The scripted screen ${name} is missing.`);
  return observation;
}

describe('Recorder', () => {
  it('records the template a fill typed, and a bundle derived from the real field, never the value', () => {
    const recorder = createRecorder({ profile, redactor, inputs: { memberId: '10001' } });

    const recorded = recorder.record({ tool: 'fill', observation: screen('search'), ref: 'n3', inputName: 'memberId' });

    expect(recorded).toMatchObject({ index: 0, tool: 'fill', framePath: ['content'], value: '{{inputs.memberId}}' });
    expect(recorded.bundle?.strategies.length).toBeGreaterThan(0);
    expect(JSON.stringify(recorder.actions())).not.toContain('10001');
  });

  it('records an extract with its output name and a bundle for the value cell', () => {
    const recorder = createRecorder({ profile, redactor, inputs: { memberId: '10001' } });

    const recorded = recorder.record({ tool: 'extract', observation: screen('detail'), ref: 's3', output: 'savingsBalance' });

    expect(recorded).toMatchObject({ tool: 'extract', output: 'savingsBalance', framePath: ['content'] });
    expect(recorded.bundle?.strategies).toContainEqual(expect.objectContaining({ kind: 'anchor-relative', relation: 'rightOf' }));
  });

  it('records a navigate with the path the model gave, which can only carry templates', () => {
    const recorder = createRecorder({ profile, redactor, inputs: { memberId: '10001' } });

    expect(recorder.record({ tool: 'navigate', observation: screen('search'), path: '/member/{{inputs.memberId}}', framePath: ['content'] })).toMatchObject({
      tool: 'navigate',
      path: '/member/{{inputs.memberId}}',
      framePath: ['content'],
      bundle: null,
    });
  });

  it('stores the acted element neighbourhood with member data masked', () => {
    const recorder = createRecorder({ profile, redactor, inputs: { memberId: '10001' } });

    const recorded = recorder.record({ tool: 'extract', observation: screen('detail'), ref: 's3', output: 'savingsBalance' });

    const neighbourhood = JSON.stringify(recorded.neighbourhood);
    expect(neighbourhood).toContain('Savings');
    expect(neighbourhood).not.toMatch(/4,250\.75|Test Member One|4111|10001/);
  });

  it('records that the model declared a click a write, so the artifact can carry the effect', () => {
    const recorder = createRecorder({ profile, redactor, inputs: { memberId: '10001' } });

    const declared = recorder.record({ tool: 'click', observation: screen('search'), ref: 'n6', submits: true });
    const plain = recorder.record({ tool: 'click', observation: screen('search'), ref: 'n6' });

    expect(declared.submits).toBe(true);
    expect(plain.submits).toBe(false);
  });

  it('completes an action with whether it succeeded and changed the page', () => {
    const recorder = createRecorder({ profile, redactor, inputs: { memberId: '10001' } });
    recorder.record({ tool: 'click', observation: screen('search'), ref: 'n6' });

    recorder.complete(0, { ok: true, changed: true });

    expect(recorder.actions()[0]).toMatchObject({ ok: true, changed: true });
  });

  it('records an action whose element has no unique strategy, with what was dropped, and keeps order', () => {
    const recorder = createRecorder({ profile, redactor, inputs: { memberId: '10001' } });
    recorder.record({ tool: 'fill', observation: screen('search', true), ref: 'n3', inputName: 'memberId' });

    const recorded = recorder.record({ tool: 'click', observation: screen('search', true), ref: 'n6' });

    expect(recorded).toMatchObject({ index: 1, tool: 'click', bundle: null });
    expect(recorded.dropped.length).toBeGreaterThan(0);
    expect(recorder.actions().map((action) => action.index)).toEqual([0, 1]);
  });
});
