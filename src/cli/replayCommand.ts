import { mkdir, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { SessionControl } from '../control/controlPlane.js';
import type { ControlToken } from '../control/controlToken.js';
import { validateInputs, type InputValue } from '../core/capability/inputs.js';
import type { Capability } from '../core/capability/schema.js';
import { failureResult, type ReplayResult, type ResultBaseInput } from '../core/outcome/result.js';
import type { AppProfile } from '../core/policy/profile.js';
import type { Redactor } from '../core/redaction/redactor.js';
import { persistedResult } from '../core/redaction/resultProjection.js';
import type { GrantLedger } from '../core/policy/authorize.js';
import type { HumanActionRecord, HumanInputPort } from '../escalation/humanInput.js';
import { createRunConsole } from '../escalation/runConsole.js';
import type { CapabilityStore } from '../evidence/capabilityStore.js';
import { interventionCaptures } from '../evidence/interventionCapture.js';
import { maskedScreenshot } from '../evidence/maskedScreenshot.js';
import { createEvidenceSink } from '../evidence/sink.js';
import { replay } from '../replay/executor.js';
import type { Clock } from '../runtime/clock.js';
import type { IdProvider } from '../runtime/ids.js';
import type { ProfileLoad } from '../runtime/profile.js';
import type { GuardedSurface } from '../surface/guardedSurface.js';
import { parseFlags } from './args.js';
import { parseInputObject } from './io.js';

// npm run replay. Deterministic, with no model anywhere on this path. Stdout carries one JSON
// document, the caller projection of the result, with real output values for the process that
// asked. Everything persisted is the redacted projection, see docs/SAFETY.md section 4.
// Exit 0 means the capability ran to a typed result, a business outcome included, because no
// such member is an answer and not a failure. Exit 1 is a failure, 3 an escalation, and 2
// means the command was used wrongly and nothing ran.

export const REPLAY_EXIT = { completed: 0, failure: 1, usage: 2, escalated: 3 } as const;

const FLAGS = ['capability', 'inputs', 'evidence'] as const;

export interface ReplayLease {
  readonly surface: GuardedSurface;
  readonly control: ControlToken;
  // The control plane over the same tokens the live session gates on, already started, so a
  // person who takes the session is given a token the driver accepts and the run gets a fresh
  // one back. See docs/ESCALATION.md section 2.
  readonly session: SessionControl;
  // The same ledger the surface authorizes against, so one approval buys exactly one action.
  readonly grants: GrantLedger;
  // How a person acts on this session while they hold it. Without it the console can only watch.
  readonly human?: HumanInputPort;
  release(): Promise<void>;
}

export type ReplayLeaseResult = { readonly ok: true; readonly lease: ReplayLease } | { readonly ok: false; readonly detail: string };

export interface ReplayCommandDeps {
  readonly argv: readonly string[];
  // Null when nothing is piped, so the command can refuse rather than wait on a terminal.
  readonly readStdin: () => Promise<string | null>;
  readonly readText: (path: string) => Promise<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly store: CapabilityStore;
  readonly loadProfile: (appId: string) => Promise<ProfileLoad>;
  // Called only once the inputs are valid, so a malformed member id never opens a browser.
  readonly lease: (request: { readonly runId: string; readonly capability: Capability; readonly profile: AppProfile }) => Promise<ReplayLeaseResult>;
  readonly redactor: Redactor;
  readonly clock: Clock;
  readonly ids: IdProvider;
  readonly target: { readonly baseUrl: string };
  readonly environment: { readonly driver: string; readonly driverVersion: string };
  // Where the run hosts its operator console, and how long it waits for somebody to claim.
  readonly console: { readonly port: number; readonly host?: string; readonly claimTimeoutMs: number; readonly claimWindow?: () => Promise<void> };
}

export async function runReplayCommand(deps: ReplayCommandDeps): Promise<number> {
  const usage = (message: string): number => {
    deps.stderr(`${message}\n`);
    return REPLAY_EXIT.usage;
  };

  const flags = parseFlags(deps.argv, FLAGS);
  if (!flags.ok) return usage(flags.message);
  const capabilityPath = flags.values['capability'];
  if (capabilityPath === undefined) return usage('--capability is required. It names a file such as capabilities/member.readSavingsBalance@1.0.0.json.');

  const loaded = await deps.store.readFile(capabilityPath);
  if (!loaded.ok) return usage(loaded.detail);
  const capability = loaded.capability;

  const inputsPath = flags.values['inputs'];
  let inputText: string | null;
  try {
    inputText = inputsPath === undefined ? await deps.readStdin() : await deps.readText(inputsPath);
  } catch {
    return usage('The inputs file could not be read.');
  }
  if (inputText === null) return usage('Pipe the inputs as a JSON object on stdin, or name a file with --inputs.');
  const supplied = parseInputObject(inputText);
  if (supplied === null) return usage('The inputs must be one JSON object keyed by input name.');

  const profile = await deps.loadProfile(capability.app.appId);
  if (!profile.ok) return usage(profile.message);

  const runId = deps.ids.next('run');
  const startedAt = deps.clock.now().toISOString();
  const sink = await createEvidenceSink({ root: flags.values['evidence'] ?? 'evidence', phase: 'replay', runId, redactor: deps.redactor, clock: deps.clock });
  // The lifecycle the run replayed under, so evidence of an approved run reads differently from
  // evidence of a draft one.
  await sink.log('info', 'replay.started', {
    capability: { id: capability.id, version: capability.version, status: capability.lifecycle.status },
    inputNames: Object.keys(supplied).sort(),
  });

  const base = (): ResultBaseInput => ({
    runId,
    capability: { id: capability.id, version: capability.version },
    inputNames: Object.keys(supplied),
    startedAt,
    endedAt: deps.clock.now().toISOString(),
    stepsAttempted: 0,
    stepsCompleted: 0,
  });

  let result: ReplayResult;
  const validated = validateInputs(capability.inputs, supplied);
  if (!validated.ok) {
    result = failureResult(base(), {
      class: 'InputValidation',
      atStepId: null,
      stepIntent: null,
      expected: 'Inputs that satisfy the declared constraints.',
      observed: validated.problems.map((problem) => problem.message).join(' '),
      retryable: false,
    });
  } else {
    const leased = await deps.lease({ runId, capability, profile: profile.profile });
    if (!leased.ok) {
      result = failureResult(base(), { class: 'SurfaceUnavailable', atStepId: null, stepIntent: null, expected: 'A signed in session on the target app.', observed: leased.detail, retryable: true });
    } else {
      const { surface, session, grants, human } = leased.lease;
      const inputs = Object.fromEntries(Object.entries(validated.values).map(([name, value]) => [name, String(value)]));
      const humanActions: HumanActionRecord[] = [];
      let lastShown: Uint8Array | null = null;
      const console_ = await createRunConsole({
        control: session,
        screenshot: maskedScreenshot(surface, profile.profile),
        ...(human === undefined ? {} : { input: human }),
        onHumanAction: (record) => humanActions.push(record),
        onScreenshotServed: (bytes) => {
          lastShown = bytes;
        },
        subject: () => Object.fromEntries(Object.entries(validated.values).map(([name, value]) => [name, String(value)])),
        redactor: deps.redactor,
        known: [],
        clock: deps.clock,
        ids: deps.ids,
        claimTimeoutMs: deps.console.claimTimeoutMs,
      ...(deps.console.claimWindow === undefined ? {} : { claimWindow: deps.console.claimWindow }),
        ...(deps.console.host === undefined ? {} : { host: deps.console.host }),
        port: deps.console.port,
        // Stderr, because stdout carries one JSON document and nothing else.
        announce: (line) => deps.stderr(`A person is needed. ${line}
`),
      });
      try {
        result = await replay(capability, supplied, {
          surface,
          control: leased.lease.control,
          clock: deps.clock,
          runId,
          profile: profile.profile,
          escalation: console_.escalation,
          grants,
          capture: interventionCaptures({ sink, profile: profile.profile, redactor: deps.redactor, inputs, observe: () => surface.observe(), screenshot: (refs) => surface.screenshot(refs) }),
        });
      } finally {
        await console_.close();
        await leased.lease.release();
      }
      // What a person did while they held the session, which never amends the artifact.
      for (const record of humanActions) await sink.appendJsonLine('humanActions.jsonl', 'trace', 'What a person did while they held the session', record);
    }
  }

  await sink.log(result.status === 'failure' ? 'error' : 'info', 'replay.result', { result: persistedResult(result, capability, primitives(supplied), deps.redactor) });
  await sink.close({
    capability: { id: capability.id, version: capability.version },
    goal: null,
    target: { appId: capability.app.appId, baseUrl: deps.target.baseUrl },
    result: { status: result.status, ...codeOf(result), summary: summaryOf(result) },
    counts: {
      steps: capability.steps.length,
      modelCalls: 0,
      actions: result.stepsAttempted,
      recoveries: result.recoveries.length,
      drift: result.drift.length,
      escalations: result.interventions.length,
    },
    environment: { ...deps.environment, model: null, promptVersion: null },
  });

  await fileByOutcome(sink.directory, result.status);
  // Where the run is, not where this machine keeps it. A caller pastes what a command prints.
  const runDirectory = `${sink.reference.split('/')[0] ?? 'evidence'}/replay/${FOLDER[result.status]}/${sink.runId}`;
  deps.stdout(`${JSON.stringify({ ...result, evidence: { runDirectory } }, null, 2)}\n`);
  return exitFor(result);
}

// Evidence is filed by outcome once the outcome is known, so evidence/replay/success and
// evidence/replay/businessOutcome read as docs/EVIDENCE.md section 1 describes them. The sink
// writes during the run, when the outcome is not known yet, so the directory moves at the end.
const FOLDER: Readonly<Record<ReplayResult['status'], string>> = {
  success: 'success',
  business_outcome: 'businessOutcome',
  escalated: 'escalated',
  failure: 'failure',
};

async function fileByOutcome(directory: string, status: ReplayResult['status']): Promise<string> {
  const filed = join(dirname(directory), FOLDER[status], basename(directory));
  await mkdir(dirname(filed), { recursive: true });
  await rename(directory, filed);
  return filed;
}

function exitFor(result: ReplayResult): number {
  switch (result.status) {
    case 'success':
    case 'business_outcome':
      return REPLAY_EXIT.completed;
    case 'escalated':
      return REPLAY_EXIT.escalated;
    case 'failure':
      return REPLAY_EXIT.failure;
  }
}

function codeOf(result: ReplayResult): { readonly code?: string } {
  switch (result.status) {
    case 'success':
      return {};
    case 'business_outcome':
      return { code: result.outcome.code };
    case 'escalated':
      return { code: result.intervention.reason };
    case 'failure':
      return { code: result.failure.class };
  }
}

// Names and codes only. A summary is persisted, so it never carries a value.
function summaryOf(result: ReplayResult): string {
  switch (result.status) {
    case 'success':
      return `Returned ${Object.keys(result.outputs).join(', ') || 'no outputs'}.`;
    case 'business_outcome':
      return `Ended with the business outcome ${result.outcome.code}.`;
    case 'escalated':
      return `Escalated with ${result.intervention.reason}.`;
    case 'failure':
      return result.failure.atStepId === null ? `Failed with ${result.failure.class} before the first step.` : `Failed with ${result.failure.class} at step ${result.failure.atStepId}.`;
  }
}

function primitives(supplied: Readonly<Record<string, unknown>>): Record<string, InputValue> {
  const values: Record<string, InputValue> = {};
  for (const [name, value] of Object.entries(supplied)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[name] = value;
  }
  return values;
}
