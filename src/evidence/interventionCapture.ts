import { sensitiveFields, type AppProfile } from '../core/policy/profile.js';
import { maskTree } from '../core/redaction/maskTree.js';
import type { Redactor } from '../core/redaction/redactor.js';
import type { Observation } from '../core/surfaceModel/types.js';
import type { EvidenceSink } from './sink.js';

// The screen and the tree a person was shown when a run stopped for them, see
// docs/EVIDENCE.md section 3. An intervention that points at nothing is a log line, so the
// refs it carries have to name files that exist by the time the console serves them.
//
// Both are masked before they are written, the screenshot by the driver so the member data
// never reaches the bytes, and the tree the same way the trace masks a neighbourhood.

export interface InterventionCaptureOptions {
  readonly sink: EvidenceSink;
  readonly profile: AppProfile;
  readonly redactor: Redactor;
  readonly inputs: Readonly<Record<string, string>>;
  readonly observe: () => Promise<Observation>;
  readonly screenshot: (maskRefs: readonly string[]) => Promise<Uint8Array>;
}

export interface InterventionRefs {
  readonly screenshotRef: string;
  readonly snapshotRef: string;
}

export function interventionCaptures(options: InterventionCaptureOptions): () => Promise<InterventionRefs> {
  let taken = 0;

  return async () => {
    taken += 1;
    const name = `intervention-${String(taken).padStart(2, '0')}`;
    return captureScreen(options, name, `a person was shown at handoff ${taken}`);
  };
}

// The screen a run failed on. A structured result says what was expected and what was
// observed, which is enough to know a run broke and rarely enough to see why. This is the
// richer signal, and it is taken after the executor has given up, so the page is still
// exactly where it stopped.
export async function captureFailure(options: InterventionCaptureOptions): Promise<InterventionRefs> {
  return captureScreen(options, 'failure', 'the run failed on');
}

async function captureScreen(options: InterventionCaptureOptions, name: string, what: string): Promise<InterventionRefs> {
  const observation = await options.observe();
  const sensitive = sensitiveFields(options.profile, observation);

  await options.sink.writeScreenshot(`captures/${name}.png`, `The screen ${what}, with member data masked`, await options.screenshot([...sensitive.keys()]));
  await options.sink.writeJson(`captures/${name}.a11y.json`, 'snapshot', `The accessibility tree ${what}, with member data masked`, {
    ...observation,
    root: maskTree(observation.root, { sensitive, inputs: options.inputs, redactor: options.redactor }),
  });

  return { screenshotRef: `captures/${name}.png`, snapshotRef: `captures/${name}.a11y.json` };
}
