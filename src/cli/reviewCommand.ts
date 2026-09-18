import { dirname } from 'node:path';
import { z } from 'zod';
import type { SessionControl } from '../control/controlPlane.js';
import type { ControlToken } from '../control/controlToken.js';
import { capabilityDiff } from '../core/capability/diff.js';
import { validateInputs } from '../core/capability/inputs.js';
import type { Capability } from '../core/capability/schema.js';
import { resolveBundle } from '../core/locator/resolve.js';
import type { ReplayResult } from '../core/outcome/result.js';
import { sensitiveFields, type AppProfile } from '../core/policy/profile.js';
import { maskTree } from '../core/redaction/maskTree.js';
import type { Redactor } from '../core/redaction/redactor.js';
import { persistedResult } from '../core/redaction/resultProjection.js';
import { matchStrategy } from '../core/surfaceModel/match.js';
import type { Observation } from '../core/surfaceModel/types.js';
import { declareOutcome, type OutcomeDeclaration } from '../discovery/outcomeProbe.js';
import type { CapabilityStore } from '../evidence/capabilityStore.js';
import type { GrantLedger } from '../core/policy/authorize.js';
import type { HumanActionRecord, HumanInputPort } from '../escalation/humanInput.js';
import { createRunConsole } from '../escalation/runConsole.js';
import { interventionCaptures } from '../evidence/interventionCapture.js';
import { createEvidenceSink } from '../evidence/sink.js';
import { replay, type ReplayContext } from '../replay/executor.js';
import type { Clock } from '../runtime/clock.js';
import type { IdProvider } from '../runtime/ids.js';
import type { ProfileLoad } from '../runtime/profile.js';
import type { GuardedSurface } from '../surface/guardedSurface.js';
import { parseFlags } from './args.js';
import { parseInputObject } from './io.js';

// npm run review. The negative probe of ADR 0018, and the approval gate. The probe replays the
// draft with an input that should not succeed, stops where its postcondition fails, and derives
// the outcome detector from the real banner on that screen. Nothing is written until a second
// replay of the reviewed version returns the outcome, so a detector that does not work never
// reaches an artifact. Naming the outcome stays a human decision.
// Exit 0 means an outcome was declared or an approval was written, 1 a refusal, and 2 a usage
// error where nothing ran.

export const REVIEW_EXIT = { declared: 0, failure: 1, usage: 2 } as const;

const FLAGS = ['capability', 'decision', 'inputs', 'evidence', 'approve'] as const;

// What a reviewer decides. The text names the banner on the screen the probe stops on, and the
// detector is derived from that element, see ADR 0018.
export const ReviewDecision = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'must be upper snake case'),
  description: z.string().min(1),
  terminal: z.boolean(),
  elementText: z.string().min(1),
});
export type ReviewDecision = z.output<typeof ReviewDecision>;

export interface ReviewLease {
  readonly surface: GuardedSurface;
  readonly control: ControlToken;
  // The same three the other two commands take. A review probes a capability by replaying it,
  // so a review of one that writes needs a person exactly as a replay of it does.
  readonly session: SessionControl;
  readonly grants: GrantLedger;
  readonly human?: HumanInputPort;
  release(): Promise<void>;
}

export type ReviewLeaseResult = { readonly ok: true; readonly lease: ReviewLease } | { readonly ok: false; readonly detail: string };

export interface ReviewCommandDeps {
  readonly argv: readonly string[];
  readonly readStdin: () => Promise<string | null>;
  readonly readText: (path: string) => Promise<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  // The reviewed version lands beside the artifact it came from, so the store is made from the
  // directory of the capability named on the command line.
  readonly makeStore: (directory: string) => CapabilityStore;
  readonly loadProfile: (appId: string) => Promise<ProfileLoad>;
  readonly lease: (request: { readonly runId: string; readonly profile: AppProfile }) => Promise<ReviewLeaseResult>;
  readonly redactor: Redactor;
  readonly clock: Clock;
  readonly ids: IdProvider;
  readonly target: { readonly baseUrl: string };
  readonly environment: { readonly driver: string; readonly driverVersion: string };
  // Where the run hosts its operator console, and how long it waits for somebody to claim.
  readonly console: { readonly port: number; readonly host?: string; readonly claimTimeoutMs: number };
}

// What a console hands a replay. Named, because three commands now pass the same three things.
interface ReplayHandoff {
  readonly escalation: ReplayContext['escalation'];
  readonly grants: ReplayContext['grants'];
  readonly capture: ReplayContext['capture'];
}

interface Refusal {
  readonly reason: string;
  readonly detail: string;
}

export async function runReviewCommand(deps: ReviewCommandDeps): Promise<number> {
  const usage = (message: string): number => {
    deps.stderr(`${message}\n`);
    return REVIEW_EXIT.usage;
  };

  const flags = parseFlags(deps.argv, FLAGS);
  if (!flags.ok) return usage(flags.message);
  const capabilityPath = flags.values['capability'];
  if (capabilityPath === undefined) return usage('--capability is required. It names the draft under review.');

  const store = deps.makeStore(dirname(capabilityPath));
  const loaded = await store.readFile(capabilityPath);
  if (!loaded.ok) return usage(loaded.detail);
  const capability = loaded.capability;

  const approver = flags.values['approve'];
  if (approver !== undefined) {
    const approvedAt = deps.clock.now().toISOString();
    const approved = await store.approve(capability.id, capability.version, { approvedBy: approver, approvedAt });
    if (!approved.ok) {
      deps.stderr(`${approved.detail}\n`);
      return REVIEW_EXIT.failure;
    }
    deps.stdout(`${JSON.stringify({ status: 'approved', capability: { id: capability.id, version: capability.version }, approvedBy: approver, approvedAt, path: approved.path }, null, 2)}\n`);
    return REVIEW_EXIT.declared;
  }

  const decisionPath = flags.values['decision'];
  if (decisionPath === undefined) return usage('--decision is required. It names the review that declares the outcome.');
  let decisionText: string;
  try {
    decisionText = await deps.readText(decisionPath);
  } catch {
    return usage(`The review at ${decisionPath} could not be read.`);
  }
  let decisionJson: unknown;
  try {
    decisionJson = JSON.parse(decisionText);
  } catch {
    return usage(`The review at ${decisionPath} is not valid JSON.`);
  }
  const parsedDecision = ReviewDecision.safeParse(decisionJson);
  if (!parsedDecision.success) {
    return usage(`The review at ${decisionPath} is invalid. ${parsedDecision.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('. ')}.`);
  }
  const decision = parsedDecision.data;

  if (capability.lifecycle.status !== 'draft') return usage(`${capability.id} version ${capability.version} is ${capability.lifecycle.status}. A review declares an outcome on a draft.`);

  const inputsPath = flags.values['inputs'];
  let inputText: string | null;
  try {
    inputText = inputsPath === undefined ? await deps.readStdin() : await deps.readText(inputsPath);
  } catch {
    return usage('The inputs file could not be read.');
  }
  if (inputText === null) return usage('Pipe the probe inputs as a JSON object on stdin, or name a file with --inputs.');
  const supplied = parseInputObject(inputText);
  if (supplied === null) return usage('The probe inputs must be one JSON object keyed by input name.');
  const validated = validateInputs(capability.inputs, supplied);
  if (!validated.ok) return usage(`The probe inputs do not satisfy the capability. ${validated.problems.map((problem) => problem.message).join(' ')}`);
  const inputs: Record<string, string> = Object.fromEntries(Object.entries(validated.values).map(([name, value]) => [name, String(value)]));

  const profile = await deps.loadProfile(capability.app.appId);
  if (!profile.ok) return usage(profile.message);

  const runId = deps.ids.next('run');
  const sink = await createEvidenceSink({ root: flags.values['evidence'] ?? 'evidence', phase: 'review', runId, redactor: deps.redactor, clock: deps.clock });
  sink.addKnown({
    known: capability.inputs.flatMap((spec) => {
      const value = inputs[spec.name];
      return (spec.sensitivity === 'pii' || spec.sensitivity === 'secret') && value !== undefined && value !== '' ? [{ value, replacement: `{{inputs.${spec.name}}}` }] : [];
    }),
  });
  await sink.log('info', 'review.started', { capability: { id: capability.id, version: capability.version }, code: decision.code, inputNames: Object.keys(inputs).sort() });

  // A review probes a capability by replaying it, so a review of one that writes stops for a
  // person at exactly the step a replay would. Each lease is its own browser session with its
  // own tokens, so each gets its own console, opened and closed around the run it serves.
  const humanActions: HumanActionRecord[] = [];
  const withConsole = async <T>(lease: ReviewLease, run: (context: ReplayHandoff) => Promise<T>): Promise<T> => {
    const { surface } = lease;
    const opened = await createRunConsole({
      control: lease.session,
      screenshot: async () => surface.screenshot([...sensitiveFields(profile.profile, await surface.observe()).keys()]),
      ...(lease.human === undefined ? {} : { input: lease.human }),
      onHumanAction: (record) => humanActions.push(record),
      redactor: deps.redactor,
      known: [],
      clock: deps.clock,
      ids: deps.ids,
      claimTimeoutMs: deps.console.claimTimeoutMs,
      ...(deps.console.host === undefined ? {} : { host: deps.console.host }),
      port: deps.console.port,
      // Stderr, because stdout carries one JSON summary and nothing else.
      announce: (line) => deps.stderr(`A person is needed. ${line}\n`),
    });
    try {
      return await run({
        escalation: opened.escalation,
        grants: lease.grants,
        capture: interventionCaptures({
          sink,
          profile: profile.profile,
          redactor: deps.redactor,
          inputs: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, String(value)])),
          observe: () => surface.observe(),
          screenshot: (refs) => surface.screenshot(refs),
        }),
      });
    } finally {
      await opened.close();
    }
  };

  const probeLease = await deps.lease({ runId, profile: profile.profile });
  if (!probeLease.ok) {
    deps.stderr(`${probeLease.detail}\n`);
    return REVIEW_EXIT.failure;
  }

  let refusal: Refusal | null = null;
  let declared: Extract<OutcomeDeclaration, { ok: true }> | null = null;
  let probeResult: ReplayResult;
  let stop: Observation | null = null;
  try {
    const { surface, control } = probeLease.lease;
    probeResult = await withConsole(probeLease.lease, (handoff) =>
      replay(capability, supplied, { surface, control, clock: deps.clock, runId, profile: profile.profile, ...handoff }),
    );

    if (probeResult.status !== 'failure') {
      refusal = { reason: 'ProbeDidNotStop', detail: `The probe ended as ${probeResult.status}, so there is no stopped screen to read an outcome from.` };
    } else {
      const stopped = await surface.observe();
      stop = stopped;
      const sensitive = sensitiveFields(profile.profile, stopped);
      await sink.writeScreenshot('captures/stop.png', 'The screen the probe stopped on, with member data masked', await surface.screenshot([...sensitive.keys()]));
      await sink.writeJson('captures/stop.a11y.json', 'snapshot', 'The accessibility tree of the screen the probe stopped on, with member data masked', {
        ...stopped,
        root: maskTree(stopped.root, { sensitive, inputs, redactor: deps.redactor }),
      });

      const outcome = declareOutcome(capability, stopped, decision, { inputs, profile: profile.profile, redactor: deps.redactor });
      if (!outcome.ok) {
        refusal = { reason: outcome.failure, detail: outcome.detail };
      } else {
        // The detector has to find its own element on the screen it was derived from. A bundle
        // that cannot do that would fail at replay time instead, with no reviewer watching.
        const resolution = await resolveBundle(outcome.detector, async (strategy, framePath) => matchStrategy(stopped, strategy, framePath));
        if (!resolution.ok) refusal = { reason: 'DetectorDidNotResolve', detail: `The derived detector ended as ${resolution.failure} on the screen it came from.` };
        else declared = outcome;
      }
    }
  } finally {
    await probeLease.lease.release();
  }

  // A detector is only believed once the reviewed version replays to the outcome it declares.
  let verification: ReplayResult | null = null;
  if (declared !== null) {
    const verifyLease = await deps.lease({ runId, profile: profile.profile });
    if (!verifyLease.ok) {
      refusal = { reason: 'SurfaceUnavailable', detail: verifyLease.detail };
    } else {
      try {
        verification = await withConsole(verifyLease.lease, (handoff) =>
          replay(declared.capability, supplied, {
            surface: verifyLease.lease.surface,
            control: verifyLease.lease.control,
            clock: deps.clock,
            runId,
            profile: profile.profile,
            ...handoff,
          }),
        );
      } finally {
        await verifyLease.lease.release();
      }
      if (verification.status !== 'business_outcome' || verification.outcome.code !== decision.code) {
        refusal = { reason: 'OutcomeNotObserved', detail: `Replaying the reviewed version ended as ${verification.status}, so the detector was not confirmed.` };
      }
    }
  }

  let path: string | null = null;
  if (declared !== null && refusal === null) {
    const written = await store.write(declared.capability, { inputValues: validated.values });
    if (!written.ok) {
      refusal = { reason: written.failure, detail: written.detail };
    } else {
      path = written.path;
      await sink.writeJson('artifact.diff.json', 'diff', `What the review added between ${capability.version} and ${declared.capability.version}`, {
        from: capability.version,
        to: declared.capability.version,
        changes: capabilityDiff(capability, declared.capability),
      });
    }
  }

  const reviewed: Capability | null = declared === null ? null : declared.capability;
  await sink.log('info', 'review.probe', { result: persistedResult(probeResult, capability, validated.values, deps.redactor) });
  if (verification !== null && reviewed !== null) {
    await sink.log('info', 'review.verification', { result: persistedResult(verification, reviewed, validated.values, deps.redactor) });
  }

  const probeSummary = {
    status: probeResult.status,
    ...(probeResult.status === 'failure' ? { class: probeResult.failure.class, atStepId: probeResult.failure.atStepId } : {}),
  };
  const verificationSummary =
    verification === null ? null : { status: verification.status, ...(verification.status === 'business_outcome' ? { code: verification.outcome.code } : {}) };
  const declaredVersion = reviewed === null || path === null ? null : reviewed.version;

  const summary =
    refusal === null && declaredVersion !== null
      ? {
          status: 'declared',
          code: decision.code,
          capability: { id: capability.id, version: declaredVersion },
          path,
          probe: probeSummary,
          verification: verificationSummary,
          evidence: sink.directory,
        }
      : {
          status: 'refused',
          reason: refusal?.reason ?? 'NotWritten',
          detail: deps.redactor.text(refusal?.detail ?? 'The review wrote nothing.', { known: [] }),
          probe: probeSummary,
          verification: verificationSummary,
          evidence: sink.directory,
        };

  await sink.log(refusal === null ? 'info' : 'error', 'review.finished', { ...summary, evidence: `review/${runId}`, ...(refusal === null ? { path: undefined } : {}) });
  await sink.close({
    capability: { id: capability.id, version: declaredVersion ?? capability.version },
    goal: null,
    target: { appId: capability.app.appId, baseUrl: deps.target.baseUrl },
    result: {
      status: summary.status,
      code: refusal === null ? decision.code : (refusal.reason ?? 'NotWritten'),
      summary:
        refusal === null
          ? `Declared ${decision.code} and wrote version ${declaredVersion ?? capability.version}.`
          : `Declared nothing, ${refusal.reason}.`,
    },
    counts: { steps: capability.steps.length, modelCalls: 0, actions: probeResult.stepsAttempted, recoveries: probeResult.recoveries.length, drift: probeResult.drift.length, escalations: 0 },
    environment: { ...deps.environment, model: null, promptVersion: null },
  });

  deps.stdout(`${JSON.stringify(summary, null, 2)}\n`);
  return refusal === null ? REVIEW_EXIT.declared : REVIEW_EXIT.failure;
}
