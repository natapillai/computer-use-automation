import { describe, expect, it } from 'vitest';
import { createSessionControl } from '../control/controlPlane.js';
import { createControlTokens } from '../control/controlToken.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createRunConsole, type RunConsole } from './runConsole.js';

// The console a run hosts while it is alive, see ADR 0016. Composition only. Its parts are
// tested next door. What this covers is the order, because a console that announces a URL it
// has not bound yet sends a person to a closed port at the exact moment they are needed.

const CLOCK = '2026-09-17T09:00:00.000Z';

async function console_(announce: (line: string) => void, claimWindow: () => Promise<void>, port = 0): Promise<{ run: RunConsole; tokens: ReturnType<typeof createControlTokens> }> {
  const tokens = createControlTokens('sess_000001', createSequentialIds());
  const control = createSessionControl({ sessionId: 'sess_000001', ids: createSequentialIds(), clock: createTestClock(CLOCK), runId: 'run_000001', tokens });
  control.apply('start');
  const run = await createRunConsole({
    control,
    screenshot: async () => new Uint8Array([1, 2, 3]),
    redactor: createRedactor({ neverPersist: [], redactPatterns: [] }),
    known: [],
    clock: createTestClock(CLOCK),
    ids: createSequentialIds(),
    claimTimeoutMs: 60_000,
    port,
    announce,
    claimWindow,
  });
  return { run, tokens };
}

function raise(run: RunConsole): ReturnType<typeof run.escalation.raise> {
  return run.escalation.raise({
    sessionId: 'sess_000001',
    runId: 'run_000001',
    phase: 'discovery',
    reason: 'PolicyConfirmation',
    explanation: 'This step writes to the system of record.',
    suggestedAction: 'Release the session to approve it.',
    url: 'http://localhost:4010/servicing',
    framePath: [],
    screenshotRef: 'captures/intervention-01.png',
    snapshotRef: 'captures/intervention-01.a11y.json',
    recentActions: [],
  });
}

describe('createRunConsole', () => {
  it('serves the intervention at the URL it announced, before a person is sent to it', async () => {
    const announced: string[] = [];
    const { run } = await console_(announce(announced), () => new Promise<void>(() => undefined));

    try {
      const handover = raise(run);
      await Promise.resolve();
      const line = announced[0] ?? '';
      expect(line.startsWith(run.baseUrl)).toBe(true);

      // Over a real socket, because the point of the console is that a person can reach it.
      const listed: unknown = await (await fetch(`${run.baseUrl}/interventions`)).json();
      expect(JSON.stringify(listed)).toContain('int_000001');
      expect(line).toContain('int_000001');
      void handover;
    } finally {
      await run.close();
    }
  });

  it('gives the resumed run a token the live session accepts', async () => {
    const { run, tokens } = await console_(
      () => undefined,
      () => new Promise<void>(() => undefined),
    );

    try {
      const handover = raise(run);
      await Promise.resolve();
      const claimed: unknown = await (await fetch(`${run.baseUrl}/interventions/int_000001/claim`, { method: 'POST' })).json();
      const token = typeof claimed === 'object' && claimed !== null ? Reflect.get(claimed, 'humanToken') : undefined;
      await fetch(`${run.baseUrl}/interventions/int_000001/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-control-token': String(token) },
        body: JSON.stringify({ approval: true }),
      });

      const settled = await handover;
      expect(settled.kind).toBe('resumed');
      if (settled.kind !== 'resumed') return;
      expect(() => tokens.assertCurrent(settled.token)).not.toThrow();
    } finally {
      await run.close();
    }
  });

  it('stops serving once the run is over', async () => {
    const { run } = await console_(
      () => undefined,
      () => new Promise<void>(() => undefined),
    );
    const base = run.baseUrl;
    await run.close();

    await expect(fetch(`${base}/interventions`)).rejects.toThrow();
  });
  it('binds somewhere else when its port is taken, rather than ending the run over a port', async () => {
    const first = await console_(() => undefined, () => new Promise<void>(() => undefined));
    const port = Number(new URL(first.run.baseUrl).port);

    try {
      // The same port, already held. A run that stops for a person has to reach one, and a
      // console is a convenience on a known port rather than a contract about which port.
      const second = await console_(() => undefined, () => new Promise<void>(() => undefined), port);
      try {
        expect(second.run.baseUrl).not.toBe(first.run.baseUrl);
        expect((await fetch(`${second.run.baseUrl}/interventions`)).ok).toBe(true);
      } finally {
        await second.run.close();
      }
    } finally {
      await first.run.close();
    }
  });
});

function announce(into: string[]): (line: string) => void {
  return (line) => into.push(line);
}
