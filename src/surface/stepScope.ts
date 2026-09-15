import type { StepEffect } from '../core/policy/profile.js';

// Which step the session is running, shared by GuardedSurface and the broker's network
// guard. GuardedSurface enters a step just before acting, and the step stays current
// through the wait that follows, because the requests a click causes fire after the click
// returns. Every refusal is recorded against the step that was current when it happened.

export interface StepRefusal {
  readonly stepId: string | null;
  readonly rule: string;
}

export interface StepScope {
  current(): StepEffect | null;
  enter(step: StepEffect): void;
  clear(): void;
  refuse(rule: string): void;
  refusals(): readonly StepRefusal[];
}

export function createStepScope(): StepScope {
  let step: StepEffect | null = null;
  const log: StepRefusal[] = [];

  return {
    current: () => step,
    enter: (next) => {
      step = next;
    },
    clear: () => {
      step = null;
    },
    refuse: (rule) => {
      log.push({ stepId: step === null ? null : step.stepId, rule });
    },
    refusals: () => [...log],
  };
}
