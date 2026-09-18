export interface Clock {
  now(): Date;
  delay(ms: number): Promise<void>;
}

export interface TestClock extends Clock {
  advance(ms: number): void;
}

// The one place in the system a raw timer is allowed. Everything else waits on a
// condition, or on Clock.delay for retry backoff, so tests can swap in a test clock.
export const systemClock: Clock = {
  now: () => new Date(),
  delay: (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

// Virtual time. A delay advances the clock and resolves at once, so time dependent
// code runs deterministically with no fake timers and no waiting.
export function createTestClock(start: string | Date): TestClock {
  let current = new Date(start).getTime();

  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
    delay: async (ms) => {
      current += ms;
    },
  };
}

// A deadline that does not by itself keep the process alive. The claim window is one. It only
// matters while a run is sitting there waiting for a person, and the run has a browser and a
// console holding the loop open for exactly that long. Once the person has answered and
// everything is closed, a referenced timer would leave the command at the shell for the rest of
// the window with nothing left to decide.
export function expireAfter(ms: number): Promise<void> {
  return new Promise<void>((done) => {
    setTimeout(done, ms).unref();
  });
}
