import type { Observation } from '../core/surfaceModel/types.js';
import type { DiscoveryEvent, DiscoveryResult } from './agentLoop.js';
import type { RecordedAction, Recorder } from './recorder.js';

// The raw truth of one discovery run, see docs/ARCHITECTURE.md section 6 and docs/EVIDENCE.md
// section 3. Observation hashes, decisions, authorization verdicts and outcomes arrive as
// events, and every recorded action carries its derived bundle and redacted neighbourhood.
// It is evidence and the generalizer's input, never a deliverable artifact.
export interface RunTrace {
  readonly runId: string;
  readonly goal: string;
  readonly inputNames: readonly string[];
  readonly actions: readonly RecordedAction[];
  readonly events: readonly DiscoveryEvent[];
  readonly extracted: Readonly<Record<string, { readonly ref: string; readonly text: string }>>;
  readonly finalObservation: Observation;
}

export interface TraceParts {
  readonly runId: string;
  readonly goal: string;
  readonly inputNames: readonly string[];
  readonly result: DiscoveryResult;
  readonly recorder: Recorder;
  readonly events: readonly DiscoveryEvent[];
}

export function buildTrace(parts: TraceParts): RunTrace {
  if (parts.result.finalObservation === null) throw new TypeError('A trace needs the observation the run ended on.');
  return {
    runId: parts.runId,
    goal: parts.goal,
    inputNames: [...parts.inputNames],
    actions: parts.recorder.actions(),
    events: [...parts.events],
    extracted: parts.result.extracted,
    finalObservation: parts.result.finalObservation,
  };
}
