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

  it('records an action whose element has no unique strategy, with what was dropped, and keeps order', () => {
    const recorder = createRecorder({ profile, redactor, inputs: { memberId: '10001' } });
    recorder.record({ tool: 'fill', observation: screen('search', true), ref: 'n3', inputName: 'memberId' });

    const recorded = recorder.record({ tool: 'click', observation: screen('search', true), ref: 'n6' });

    expect(recorded).toMatchObject({ index: 1, tool: 'click', bundle: null });
    expect(recorded.dropped.length).toBeGreaterThan(0);
    expect(recorder.actions().map((action) => action.index)).toEqual([0, 1]);
  });
});
