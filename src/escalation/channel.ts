import type { SessionControl } from '../control/controlPlane.js';
import type { EscalationReason } from '../core/outcome/result.js';
import type { KnownValue, Redactor } from '../core/redaction/redactor.js';
import type { Clock } from '../runtime/clock.js';
import type { IdProvider } from '../runtime/ids.js';
import { raiseIntervention, type ActionSummary, type InterventionStore } from './intervention.js';

// Where a run stops for a person. An intervention nobody can answer is a log line, so raising
// one blocks the run in pending_human, prints where the session can be taken over, and waits
// for a claim and a release, see ADR 0016 and docs/ESCALATION.md section 5.

export type Handover =
  | { readonly kind: 'resumed'; readonly interventionId: string }
  | { readonly kind: 'aborted'; readonly interventionId: string }
  | { readonly kind: 'unclaimed'; readonly interventionId: string };

export interface RaiseInput {
  readonly sessionId: string;
  readonly runId: string;
  readonly phase: 'discovery' | 'replay';
  readonly reason: EscalationReason;
  readonly explanation: string;
  readonly suggestedAction: string;
  readonly capability?: { readonly id: string; readonly version: string };
  readonly goal?: string;
  readonly atStep?: { readonly id: string; readonly index: number; readonly intent: string };
  readonly url: string;
  readonly framePath: readonly string[];
  readonly screenshotRef: string;
  readonly snapshotRef: string;
  readonly recentActions: readonly ActionSummary[];
}

export interface EscalationChannel {
  raise(input: RaiseInput): Promise<Handover>;
}

export interface EscalationChannelOptions {
  readonly store: InterventionStore;
  readonly control: SessionControl;
  readonly clock: Clock;
  readonly ids: IdProvider;
  readonly redactor: Redactor;
  readonly known: readonly KnownValue[];
  readonly consoleBaseUrl: string;
  readonly claimTimeoutMs: number;
  readonly announce: (line: string) => void;
  // How long a claim may take to arrive. It is a seam because a claim window that cannot be
  // closed on demand could only be tested by waiting, and nothing in this repository waits.
  readonly claimWindow?: () => Promise<void>;
}

export function createEscalationChannel(options: EscalationChannelOptions): EscalationChannel {
  const claimWindow = options.claimWindow ?? (() => options.clock.delay(options.claimTimeoutMs));

  return {
    raise: async (input) => {
      const intervention = raiseIntervention({
        ...input,
        store: options.store,
        clock: options.clock,
        ids: options.ids,
        redactor: options.redactor,
        known: options.known,
        consoleBaseUrl: options.consoleBaseUrl,
        claimTimeoutMs: options.claimTimeoutMs,
      });

      options.control.apply('pause', { interventionId: intervention.id });
      // Printed so the handoff is demonstrable from the terminal rather than only present in
      // the code, see ADR 0016.
      options.announce(intervention.consoleUrl);

      return await new Promise<Handover>((settled) => {
        const stop = options.store.subscribe((id, state) => {
          if (id !== intervention.id) return;
          if (state === 'released') {
            stop();
            settled({ kind: 'resumed', interventionId: id });
          } else if (state === 'aborted') {
            stop();
            settled({ kind: 'aborted', interventionId: id });
          }
        });

        void claimWindow().then(() => {
          // Only an unclaimed intervention expires. Once a person holds the session they are
          // working on it, and taking it back mid action is worse than waiting for them.
          if (options.store.status(intervention.id) !== 'open') return;
          stop();
          options.store.settle(intervention.id, 'expired');
          options.control.apply('timeout');
          settled({ kind: 'unclaimed', interventionId: intervention.id });
        });
      });
    },
  };
}
