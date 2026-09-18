import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import profileJson from '../../profiles/meridian-core.json' with { type: 'json' };
import { meridianScript } from '../../tests/fixtures/surface/meridianScreens.js';
import { AppProfile } from '../core/policy/profile.js';
import { createRedactor } from '../core/redaction/redactor.js';
import type { Observation } from '../core/surfaceModel/types.js';
import { createTestClock } from '../runtime/clock.js';
import { interventionCaptures } from './interventionCapture.js';
import { createEvidenceSink } from './sink.js';

// What a person is shown when a run stops for them, filed as evidence. The screenshot is masked
// before its bytes exist and the snapshot is masked the same way the trace masks a
// neighbourhood, so the record of the handoff carries no member data. See docs/EVIDENCE.md.

const profile = AppProfile.parse(profileJson);

function detail(): Observation {
  const observation = meridianScript().screens['detail'];
  if (observation === undefined) throw new Error('The scripted detail screen is missing.');
  return observation;
}

describe('interventionCaptures', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'intervention-capture-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('numbers each handoff and files a masked screen and snapshot for it', async () => {
    const redactor = createRedactor({ neverPersist: [], redactPatterns: [] });
    const sink = await createEvidenceSink({ root, phase: 'replay', runId: 'run_000001', redactor, clock: createTestClock('2026-09-17T09:00:00.000Z') });
    const masked: string[][] = [];
    const capture = interventionCaptures({
      sink,
      profile,
      redactor,
      inputs: { memberId: '10001' },
      observe: async () => detail(),
      screenshot: async (refs) => {
        masked.push([...refs]);
        return new Uint8Array([137, 80, 78, 71]);
      },
    });

    const first = await capture();
    const second = await capture();

    expect(first).toEqual({ screenshotRef: 'captures/intervention-01.png', snapshotRef: 'captures/intervention-01.a11y.json' });
    expect(second).toEqual({ screenshotRef: 'captures/intervention-02.png', snapshotRef: 'captures/intervention-02.a11y.json' });
    // The screenshot is masked at source. Nothing here can unmask it later.
    expect(masked[0]?.length).toBeGreaterThan(0);

    const snapshot = await readFile(join(sink.directory, 'captures/intervention-01.a11y.json'), 'utf8');
    expect(snapshot).not.toMatch(/4,250\.75|Test Member One|4111/);
    expect(snapshot).toContain('Savings');
  });
});
