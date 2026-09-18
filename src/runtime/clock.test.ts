import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestClock, expireAfter, systemClock } from './clock.js';

describe('createTestClock', () => {
  it('returns the start time until something advances it', () => {
    const clock = createTestClock('2026-09-14T09:00:00.000Z');

    expect(clock.now().toISOString()).toBe('2026-09-14T09:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-14T09:00:00.000Z');
  });

  it('advances by exactly the delayed duration without a real timer', async () => {
    const clock = createTestClock('2026-09-14T09:00:00.000Z');

    await clock.delay(1500);

    expect(clock.now().toISOString()).toBe('2026-09-14T09:00:01.500Z');
  });
});

describe('systemClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a delay only once the requested duration has passed', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const pending = systemClock.delay(500).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
  });
});

describe('expireAfter', () => {
  it('waits without holding the process open, so a deadline nobody is waiting on cannot delay an exit', async () => {
    const handles: { hasRef(): boolean }[] = [];
    const real = globalThis.setTimeout;
    const spy = ((handler: () => void, ms?: number) => {
      const handle = real(handler, ms);
      handles.push(handle as unknown as { hasRef(): boolean });
      return handle;
    }) as typeof globalThis.setTimeout;
    globalThis.setTimeout = spy;

    try {
      await expireAfter(1);
    } finally {
      globalThis.setTimeout = real;
    }

    // The claim window outlives the answer it was waiting for. A referenced timer there keeps a
    // command sitting at the shell for the rest of the window after a person has already
    // approved, which is what this asserts cannot happen.
    expect(handles).toHaveLength(1);
    expect(handles[0]?.hasRef()).toBe(false);
  });
});
