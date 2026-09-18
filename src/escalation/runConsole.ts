import type { SessionControl } from '../control/controlPlane.js';
import type { KnownValue, Redactor } from '../core/redaction/redactor.js';
import type { Clock } from '../runtime/clock.js';
import type { IdProvider } from '../runtime/ids.js';
import { createEscalationChannel, type EscalationChannel } from './channel.js';
import type { HumanActionRecord, HumanInputPort } from './humanInput.js';
import { createInterventionStore, type InterventionStore } from './intervention.js';
import { createOperatorApi, type OperatorApi } from './operatorApi.js';

// The console a run hosts for as long as it is alive, see ADR 0016 and docs/ESCALATION.md
// section 5. Discovery and replay both stop for a person, so both compose the same three
// pieces, and composing them in two places is how they drift.
//
// The order matters. The port is bound before the channel exists, so the URL a person is sent
// to is one that already answers. An announced URL that is not listening yet is worse than no
// announcement, because it arrives at the moment somebody is needed.

export interface RunConsoleOptions {
  readonly control: SessionControl;
  // Already masked. There is no unmasked screenshot anywhere in this system.
  readonly screenshot: () => Promise<Uint8Array>;
  // How a person acts on the live session. Without it the console can only watch.
  readonly input?: HumanInputPort;
  readonly onHumanAction?: (record: HumanActionRecord) => void;
  readonly redactor: Redactor;
  readonly known: readonly KnownValue[];
  readonly clock: Clock;
  readonly ids: IdProvider;
  readonly claimTimeoutMs: number;
  readonly host?: string;
  readonly port: number;
  readonly announce: (line: string) => void;
  readonly claimWindow?: () => Promise<void>;
}

export interface RunConsole {
  readonly baseUrl: string;
  readonly escalation: EscalationChannel;
  readonly store: InterventionStore;
  close(): Promise<void>;
}

export async function createRunConsole(options: RunConsoleOptions): Promise<RunConsole> {
  const store = createInterventionStore();
  const api: OperatorApi = await createOperatorApi({
    store,
    control: options.control,
    screenshot: () => options.screenshot(),
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.onHumanAction === undefined ? {} : { onHumanAction: options.onHumanAction }),
    ...(options.host === undefined ? {} : { host: options.host }),
    port: options.port,
  });
  const baseUrl = await api.listen();

  const escalation = createEscalationChannel({
    store,
    control: options.control,
    clock: options.clock,
    ids: options.ids,
    redactor: options.redactor,
    known: options.known,
    consoleBaseUrl: baseUrl,
    claimTimeoutMs: options.claimTimeoutMs,
    announce: options.announce,
    ...(options.claimWindow === undefined ? {} : { claimWindow: options.claimWindow }),
  });

  return { baseUrl, escalation, store, close: () => api.close() };
}
