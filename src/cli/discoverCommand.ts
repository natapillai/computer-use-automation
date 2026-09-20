import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { SessionControl } from '../control/controlPlane.js';
import type { ControlToken } from '../control/controlToken.js';
import { validateInputs } from '../core/capability/inputs.js';
import { AppBinding, ParamSpec, type Capability } from '../core/capability/schema.js';
import type { GrantLedger } from '../core/policy/authorize.js';
import { sensitiveFields, type AppProfile } from '../core/policy/profile.js';
import { maskTree } from '../core/redaction/maskTree.js';
import type { KnownValue, Redactor } from '../core/redaction/redactor.js';
import { runDiscovery, type DiscoveryBudgets, type DiscoveryEvent, type DiscoveryOptions, type DiscoveryResult } from '../discovery/agentLoop.js';
import { Cassette, CassetteMismatch, createCassetteModelClient } from '../discovery/cassetteModelClient.js';
import { generalize, PROMPT_VERSION, type Generalization } from '../discovery/generalizer.js';
import type { ModelClient } from '../discovery/modelClient.js';
import { buildGoal, systemPrompt } from '../discovery/prompt.js';
import { createRecorder } from '../discovery/recorder.js';
import { toolsFor } from '../discovery/tools.js';
import { buildTrace } from '../discovery/trace.js';
import type { HumanActionRecord, HumanInputPort } from '../escalation/humanInput.js';
import { createRunConsole } from '../escalation/runConsole.js';
import { createFileCapabilityStore, type CapabilityWrite } from '../evidence/capabilityStore.js';
import { interventionCaptures } from '../evidence/interventionCapture.js';
import { maskedScreenshot } from '../evidence/maskedScreenshot.js';
import { createEvidenceSink } from '../evidence/sink.js';
import type { Clock } from '../runtime/clock.js';
import type { IdProvider } from '../runtime/ids.js';
import type { ProfileLoad } from '../runtime/profile.js';
import type { GuardedSurface } from '../surface/guardedSurface.js';
import { parseFlags } from './args.js';
import { parseInputObject } from './io.js';

// npm run discover. A model drives the live surface toward a goal, the run is generalized into
// a draft capability, and the evidence the brief asks for is written, see docs/EVIDENCE.md.
// The model is live by default and needs ANTHROPIC_MODEL and a key. --model-cassette replays a
// recorded exchange instead, with no key and no network beyond the target app, and --cassette
// records a live run's exchange for exactly that. Stdout carries one JSON summary.
// Exit 0 means a capability was written, 3 an escalation, 1 any other end, and 2 means the
// command was used wrongly and nothing ran.

export const DISCOVER_EXIT = { produced: 0, failure: 1, usage: 2, escalated: 3 } as const;

const FLAGS = ['request', 'inputs', 'evidence', 'capabilities', 'cassette', 'model-cassette'] as const;

// What to discover. The goal names inputs as templates and never carries a value.
export const DiscoveryRequest = z.strictObject({
  id: z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, 'must be dotted lower camel case'),
  name: z.string().min(1),
  description: z.string().min(1),
  goal: z.string().min(1),
  app: AppBinding,
  inputs: z.array(ParamSpec).min(1),
  // Whether this request permits the run to change state. Absent means no, so a request
  // written for a read can never grow a write by accident. It decides only what the model is
  // offered. Every write still goes to a person before it reaches the surface.
  allowWrites: z.boolean().optional(),
});
export type DiscoveryRequest = z.output<typeof DiscoveryRequest>;

export interface DiscoverLease {
  readonly surface: GuardedSurface;
  readonly control: ControlToken;
  // The control plane over the same tokens the live session gates on, already started, so a
  // person who takes the session is given a token the driver accepts and the run gets a fresh
  // one back. See docs/ESCALATION.md section 2.
  readonly session: SessionControl;
  // How a person acts on this session while they hold it. Without it the console only watches.
  readonly human?: HumanInputPort;
  // The same ledger the session's policy holds, so an approval the run collects is the one
  // authorize consumes.
  readonly grants: GrantLedger;
  release(): Promise<void>;
}

export type DiscoverLeaseResult = { readonly ok: true; readonly lease: DiscoverLease } | { readonly ok: false; readonly detail: string };

export type LiveModel = { readonly ok: true; readonly client: ModelClient } | { readonly ok: false; readonly message: string };

export interface DiscoverCommandDeps {
  readonly argv: readonly string[];
  readonly readStdin: () => Promise<string | null>;
  readonly readText: (path: string) => Promise<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly loadProfile: (appId: string) => Promise<ProfileLoad>;
  // Called only once the request, the inputs and the model are known to be usable.
  readonly lease: (request: { readonly runId: string; readonly profile: AppProfile }) => Promise<DiscoverLeaseResult>;
  // Built only for a live run, so a cassette run never constructs an API client.
  readonly liveModel: () => LiveModel;
  readonly modelId: string | null;
  readonly redactor: Redactor;
  readonly budgets: DiscoveryBudgets;
  readonly clock: Clock;
  readonly ids: IdProvider;
  readonly target: { readonly baseUrl: string };
  readonly environment: { readonly driver: string; readonly driverVersion: string };
  // Where the run hosts its operator console, and how long it waits for somebody to claim.
  readonly console: { readonly port: number; readonly host?: string; readonly claimTimeoutMs: number; readonly claimWindow?: () => Promise<void> };
}

type Loaded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

export async function runDiscoverCommand(deps: DiscoverCommandDeps): Promise<number> {
  const usage = (message: string): number => {
    deps.stderr(`${message}\n`);
    return DISCOVER_EXIT.usage;
  };

  const flags = parseFlags(deps.argv, FLAGS);
  if (!flags.ok) return usage(flags.message);
  const requestPath = flags.values['request'];
  if (requestPath === undefined) return usage('--request is required. It names a discovery request such as requests/member.readSavingsBalance.json.');
  const recordTo = flags.values['cassette'];
  const replayFrom = flags.values['model-cassette'];
  if (recordTo !== undefined && replayFrom !== undefined) return usage('--cassette records a live run, so it cannot be combined with --model-cassette.');

  const loadedRequest = await readJson(deps, requestPath, DiscoveryRequest);
  if (!loadedRequest.ok) return usage(`The discovery request at ${requestPath} ${loadedRequest.problem}`);
  const request = loadedRequest.value;

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
  const validated = validateInputs(request.inputs, supplied);
  if (!validated.ok) return usage(`The inputs do not satisfy the request. ${validated.problems.map((problem) => problem.message).join(' ')}`);
  const inputs: Record<string, string> = Object.fromEntries(Object.entries(validated.values).map(([name, value]) => [name, String(value)]));

  let model: ModelClient;
  let modelId: string;
  if (replayFrom !== undefined) {
    const cassette = await readJson(deps, replayFrom, Cassette);
    if (!cassette.ok) return usage(`The cassette at ${replayFrom} ${cassette.problem}`);
    model = createCassetteModelClient(cassette.value);
    modelId = cassette.value.model;
  } else {
    if (deps.modelId === null) return usage('Invalid environment. ANTHROPIC_MODEL is required for a live discovery run.');
    if (recordTo !== undefined && (await exists(recordTo))) return usage(`A cassette already exists at ${recordTo}, and a recording is never overwritten.`);
    const live = deps.liveModel();
    if (!live.ok) return usage(live.message);
    model = live.client;
    modelId = deps.modelId;
  }

  const profile = await deps.loadProfile(request.app.appId);
  if (!profile.ok) return usage(profile.message);

  const runId = deps.ids.next('run');
  const known: KnownValue[] = request.inputs.flatMap((spec) => {
    const value = inputs[spec.name];
    return (spec.sensitivity === 'pii' || spec.sensitivity === 'secret') && value !== undefined && value !== '' ? [{ value, replacement: `{{inputs.${spec.name}}}` }] : [];
  });
  const sink = await createEvidenceSink({ root: flags.values['evidence'] ?? 'evidence', phase: 'discovery', runId, redactor: deps.redactor, clock: deps.clock });
  sink.addKnown({ known });
  await sink.log('info', 'discovery.started', { goal: request.goal, inputNames: Object.keys(inputs).sort(), model: modelId, source: replayFrom === undefined ? 'live' : 'cassette' });

  // A live run opens a browser, signs in and then waits on a model, which is a long time to
  // show nothing. Silence and a hang look identical from a terminal, so the run says what it is
  // doing as it does it. All of it goes to stderr, because stdout carries one JSON summary.
  const note = (line: string): void => deps.stderr(`${line}\n`);
  note(`discover ${runId} ${request.id}`);
  note(`evidence discovery/${runId}`);

  const events: DiscoveryEvent[] = [];
  const recorder = createRecorder({ profile: profile.profile, redactor: deps.redactor, inputs });
  const TRACE = 'Every observation, decision, authorization, action and derivation of the run';

  // Written as they happen rather than collected and written at the end. A run that stops for a
  // person can sit there for a quarter of an hour, and one that is killed while it waits used to
  // leave a directory with nothing in it but the opening log line. That is what
  // docs/ESCALATION.md section 9 claims evidence does not do.
  //
  // Nothing streamed here carries a value. Events carry hashes, refs and input names, and an
  // exchange has already been through the observation builder, which masks before any text
  // exists. The derivations are appended at the end because they carry a masked neighbourhood
  // the recorder only finishes once the action has run.
  let writing: Promise<void> = Promise.resolve();
  const stream = (path: string, kind: 'trace' | 'transcript', description: string, value: unknown): void => {
    writing = writing.then(() => sink.appendJsonLine(path, kind, description, value));
  };
  const unreached = (reason: 'SurfaceUnavailable' | 'ModelCallFailed', detail: string): DiscoveryResult => ({
    status: 'failure',
    reason,
    detail,
    modelCalls: 0,
    actions: 0,
    extracted: {},
    exchanges: [],
    finalObservation: null,
  });

  let result: DiscoveryResult;
  const leased = await deps.lease({ runId, profile: profile.profile });
  if (!leased.ok) {
    result = unreached('SurfaceUnavailable', leased.detail);
  } else {
    const { surface, control } = leased.lease;
    // The screenshot is masked before its bytes exist, and the snapshot is masked the same way
    // the trace masks a neighbourhood. The sink redacts both again with the run's known values.
    const capture: NonNullable<DiscoveryOptions['capture']> = async (moment, observation) => {
      const name = moment === 'initial' ? 'step-00-initial' : 'final';
      const sensitive = sensitiveFields(profile.profile, observation);
      await sink.writeScreenshot(`captures/${name}.png`, `The ${moment} screen with member data masked`, await surface.screenshot([...sensitive.keys()]));
      await sink.writeJson(`captures/${name}.a11y.json`, 'snapshot', `The ${moment} accessibility tree with member data masked`, {
        ...observation,
        root: maskTree(observation.root, { sensitive, inputs, redactor: deps.redactor }),
      });
    };
    const humanActions: HumanActionRecord[] = [];
    let decisions = 0;
    let lastShown: Uint8Array | null = null;
    const runConsole = await createRunConsole({
      control: leased.lease.session,
      screenshot: maskedScreenshot(surface, profile.profile),
      ...(leased.lease.human === undefined ? {} : { input: leased.lease.human }),
      onHumanAction: (record) => humanActions.push(record),
      onScreenshotServed: (bytes) => {
        lastShown = bytes;
      },
      // Shown only to whoever holds the session, and written nowhere. An operator asked to
      // authorise a write has to be able to say which record it is for.
      subject: () => inputs,
      redactor: deps.redactor,
      known,
      clock: deps.clock,
      ids: deps.ids,
      claimTimeoutMs: deps.console.claimTimeoutMs,
      ...(deps.console.claimWindow === undefined ? {} : { claimWindow: deps.console.claimWindow }),
      ...(deps.console.host === undefined ? {} : { host: deps.console.host }),
      port: deps.console.port,
      // Stderr, because stdout carries one JSON summary and nothing else.
      announce: (line) => note(`A person is needed. ${line}`),
    });
    // What a person was looking at when they answered. The console serves a new frame every
    // second, so the last one it served before the answer is the one they decided on. Taking a
    // fresh screenshot here would be a different picture of a page that has already moved on.
    let decided = 0;
    runConsole.store.subscribe((_id, state) => {
      if (state !== 'released' && state !== 'aborted') return;
      const shown = lastShown;
      if (shown === null) return;
      decided += 1;
      const name = `captures/decision-${String(decided).padStart(2, '0')}.png`;
      writing = writing.then(() => sink.writeScreenshot(name, `The screen a person was looking at when they answered handoff ${decided}`, shown));
    });
    note(`console ${runConsole.baseUrl}`);
    note(`session up, driving ${request.app.appId} from ${request.app.entryPath}`);
    try {
      result = await runDiscovery({
        surface,
        control,
        model,
        modelId,
        clock: deps.clock,
        goal: request.goal,
        inputs,
        profile: profile.profile,
        redactor: deps.redactor,
        budgets: deps.budgets,
        entryPath: request.app.entryPath,
        runId,
        grants: leased.lease.grants,
        allowWrites: request.allowWrites === true,
        onEvent: (event) => {
          events.push(event);
          stream('trace.jsonl', 'trace', TRACE, event);
          // One line per decision and its outcome. Tool names, never values, which is the same
          // rule the trace follows.
          if (event.t === 'decision') note(`  [${++decisions}] ${event.tool}`);
          if (event.t === 'action' && !event.ok) note(`  [${decisions}] ${event.tool} did not work`);
          if (event.t === 'stuck') note(`  stopped, ${event.detector}`);
        },
        onExchange: (exchange) => stream('transcript.jsonl', 'transcript', 'The model exchange, redacted', exchange),
        recorder,
        capture,
        escalation: runConsole.escalation,
        interventionCapture: interventionCaptures({
          sink,
          profile: profile.profile,
          redactor: deps.redactor,
          inputs,
          observe: () => surface.observe(),
          screenshot: (refs) => surface.screenshot(refs),
        }),
      });
    } catch (error) {
      if (!(error instanceof CassetteMismatch)) throw error;
      // The diff names observation lines the model was shown, which were already redacted.
      deps.stderr(`${error.message}\n`);
      result = unreached('ModelCallFailed', 'The cassette does not match this run.');
    } finally {
      await runConsole.close();
      await leased.lease.release();
    }
    // What a person did while they held the session, which never becomes a step.
    for (const record of humanActions) await sink.appendJsonLine('humanActions.jsonl', 'humanActions', 'What a person did while they held the session', record);
  }

  // An extracted value is member data, so every later write hides it.
  const extracted = Object.values(result.extracted)
    .filter((item) => item.text.trim() !== '')
    .map((item): KnownValue => ({ value: item.text, replacement: '[redacted:pii]' }));
  known.push(...extracted);
  sink.addKnown({ known: extracted });

  await writing;
  for (const action of recorder.actions()) await sink.appendJsonLine('trace.jsonl', 'trace', TRACE, { t: 'derivation', ...action });

  let generalization: Generalization | null = null;
  let written: CapabilityWrite | null = null;
  let capability: Capability | null = null;
  let recorded = false;
  if (result.status === 'done') {
    const trace = buildTrace({ runId, goal: request.goal, inputNames: Object.keys(inputs), result, recorder, events });
    generalization = await generalize(trace, {
      id: request.id,
      name: request.name,
      description: request.description,
      app: request.app,
      inputs: request.inputs,
      inputValues: inputs,
      recordedAt: deps.clock.now().toISOString(),
      model: modelId,
      profile: profile.profile,
      redactor: deps.redactor,
    });
    if (generalization.ok) {
      written = await createFileCapabilityStore({ directory: flags.values['capabilities'] ?? 'capabilities', redactor: deps.redactor }).write(generalization.capability, { inputValues: validated.values });
      if (written.ok) {
        capability = generalization.capability;
        await sink.writeJson('artifact.json', 'artifact', 'The capability this run produced, a draft at version 1.0.0', capability);
      }
    }

    // Recorded whenever the model finished, so a generalizer problem can be worked on offline
    // without paying for the run again.
    if (recordTo !== undefined) {
      const goal = buildGoal(request.goal, inputs);
      const redacted = deps.redactor.object(
        {
          recordedAt: deps.clock.now().toISOString(),
          source: 'npm run discover',
          runId,
          model: modelId,
          system: systemPrompt({ writes: request.allowWrites === true }),
          goal: goal.ok ? goal.text : request.goal,
          inputNames: Object.keys(inputs),
          tools: toolsFor(Object.keys(inputs), { writes: request.allowWrites === true }),
          exchanges: result.exchanges,
        },
        { known },
      );
      const cassette = Cassette.safeParse(redacted);
      if (!cassette.success) throw new TypeError('The redacted recording is not a valid cassette.');
      await mkdir(dirname(recordTo), { recursive: true });
      await writeFile(recordTo, `${JSON.stringify(cassette.data, null, 2)}\n`, { flag: 'wx' });
      recorded = true;
    }
  }

  const redact = (text: string): string => deps.redactor.text(text, { known });
  const refusal = generalization !== null && !generalization.ok ? generalization : null;
  const storeRefusal = written !== null && !written.ok ? written : null;
  const summary = {
    runId,
    status: result.status,
    ...(result.status === 'done' ? {} : { reason: result.reason, detail: redact(result.detail) }),
    modelCalls: result.modelCalls,
    actions: result.actions,
    // The id and the version, not where the file landed. A caller who wants the file knows the
    // capabilities directory they passed, and a reader pasting this into a ticket should not be
    // pasting the machine it ran on.
    capability: capability === null || written === null || !written.ok ? null : { id: capability.id, version: capability.version },
    ...(refusal === null ? {} : { generalization: { failure: refusal.failure, detail: redact(refusal.detail) } }),
    ...(storeRefusal === null ? {} : { store: { failure: storeRefusal.failure, detail: redact(storeRefusal.detail) } }),
    cassette: recorded ? (recordTo ?? null) : null,
    evidence: sink.reference,
  };

  // The persisted copy names the capability by id and version and the evidence by its place in
  // the evidence tree. A local path is not evidence, and an id@version file name reads to the
  // email pattern as an address.
  const persisted = {
    ...summary,
    capability: capability === null ? null : { id: capability.id, version: capability.version },
    cassette: recorded,
  };

  const exit = capability !== null ? DISCOVER_EXIT.produced : result.status === 'escalated' ? DISCOVER_EXIT.escalated : DISCOVER_EXIT.failure;
  const code = result.status !== 'done' ? result.reason : (refusal?.failure ?? storeRefusal?.failure);
  await sink.log(exit === DISCOVER_EXIT.produced ? 'info' : 'error', 'discovery.finished', persisted);
  await sink.close({
    capability: capability === null ? null : { id: capability.id, version: capability.version },
    goal: request.goal,
    target: { appId: request.app.appId, baseUrl: deps.target.baseUrl },
    result: {
      status: result.status,
      ...(code === undefined ? {} : { code }),
      summary:
        capability !== null
          ? `Produced ${capability.id} version ${capability.version} as a draft.`
          : result.status === 'done'
            ? `The model finished and no capability was written, ${code ?? 'for no recorded reason'}.`
            : `Ended as ${result.status} with ${result.reason}.`,
    },
    counts: {
      steps: capability?.steps.length ?? 0,
      modelCalls: result.modelCalls,
      actions: result.actions,
      recoveries: 0,
      drift: 0,
      escalations: events.filter((event) => event.t === 'handback').length + (result.status === 'escalated' ? 1 : 0),
    },
    environment: { ...deps.environment, model: modelId, promptVersion: PROMPT_VERSION },
  });

  deps.stdout(`${JSON.stringify(summary, null, 2)}\n`);
  return exit;
}

async function readJson<T>(deps: Pick<DiscoverCommandDeps, 'readText'>, path: string, schema: z.ZodType<T>): Promise<Loaded<T>> {
  let text: string;
  try {
    text = await deps.readText(path);
  } catch {
    return { ok: false, problem: 'could not be read.' };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'is not valid JSON.' };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, problem: `is invalid. ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('. ')}.` };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT') return false;
    throw error;
  }
}
