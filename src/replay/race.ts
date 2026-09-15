import type { ConditionMatcher } from '../core/outcome/condition.js';
import { evaluateCondition, type EvaluationContext } from '../core/outcome/evaluate.js';
import type { Observation } from '../core/surfaceModel/types.js';
import type { Clock } from '../runtime/clock.js';
import type { GuardedSurface } from '../surface/guardedSurface.js';

export interface Contender<T> {
  readonly condition: ConditionMatcher;
  readonly entrant: T;
}

export type RaceOutcome<T> =
  | { readonly kind: 'fired'; readonly entrant: T; readonly observation: Observation }
  | { readonly kind: 'expired'; readonly observation: Observation; readonly lastDetail: string }
  | { readonly kind: 'stopped' };

// The one wait, see docs/ERROR_TAXONOMY.md sections 6 and 7. Observe, evaluate every
// contender in the order given, which is precedence order, and return the first that
// holds. Otherwise wait for the surface to change, bounded by what is left of the
// timeout, and look again. There is no sleep and no fixed delay. lastDetail comes from
// the last contender evaluated, so a caller puts the condition it wants explained last.
// stopWhen ends the wait early, for example once the network guard refused a request.
export async function race<T>(
  surface: GuardedSurface,
  clock: Clock,
  contenders: readonly Contender<T>[],
  timeoutMs: number,
  outputResolvable: (outputName: string) => Promise<boolean>,
  stopWhen: () => boolean = () => false,
): Promise<RaceOutcome<T>> {
  const deadline = clock.now().getTime() + timeoutMs;

  for (;;) {
    if (stopWhen()) return { kind: 'stopped' };
    const observation = await surface.observe();
    const context: EvaluationContext = {
      observation,
      match: (strategy, framePath) => surface.match(strategy, framePath),
      outputResolvable,
    };

    let lastDetail = '';
    for (const contender of contenders) {
      const evaluation = await evaluateCondition(contender.condition, context);
      if (evaluation.holds) return { kind: 'fired', entrant: contender.entrant, observation };
      lastDetail = evaluation.detail;
    }

    const remaining = deadline - clock.now().getTime();
    if (remaining <= 0) return { kind: 'expired', observation, lastDetail };
    await surface.waitForChange(remaining);
  }
}
