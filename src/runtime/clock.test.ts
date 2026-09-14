import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestClock, systemClock } from './clock.js';

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
