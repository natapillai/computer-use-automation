import { templateCondition } from '../core/capability/templateCondition.js';
import type { TemplateValues } from '../core/capability/resolveTemplate.js';
import type { Capability, Step } from '../core/capability/schema.js';
import type { StrategyMatcher } from '../core/locator/resolve.js';
import type { ConditionMatcher } from '../core/outcome/condition.js';
import { evaluateCondition } from '../core/outcome/evaluate.js';
import type { Observation } from '../core/surfaceModel/types.js';

// What to do when a person hands the session back, see docs/ESCALATION.md section 7. The run does
// not resume from where it stopped, because the page may be somewhere else entirely now, which
// is the whole reason the person was there. The ladder is checked in one order, widest first.

export type Resumption =
  | { readonly kind: 'success' }
  | { readonly kind: 'outcome'; readonly code: string }
  | { readonly kind: 'satisfiedByHuman' }
  | { readonly kind: 'approved' }
  | { readonly kind: 'retry' }
  | { readonly kind: 'escalate'; readonly detail: string };

export interface ResumeCheck {
  readonly capability: Capability;
  readonly step: Step;
  // Taken after the release, never reused from before the person acted.
  readonly observation: Observation;
  readonly match: StrategyMatcher;
  readonly outputResolvable: (outputName: string) => Promise<boolean>;
  readonly values: TemplateValues;
  readonly allowedEnv: readonly string[];
  // The release carried an approval for the step that asked for one.
  readonly approved: boolean;
}

export async function revalidate(check: ResumeCheck): Promise<Resumption> {
  const holds = async (condition: ConditionMatcher): Promise<boolean> => {
    const templated = templateCondition(condition, check.values, check.allowedEnv);
    if (!templated.ok) return false;
    const evaluation = await evaluateCondition(templated.value, { observation: check.observation, match: check.match, outputResolvable: check.outputResolvable });
    return evaluation.holds;
  };

  // An operator asked to unblock a two step problem will often just finish the task. Noticing
  // that beats re clicking a submit button that already posted.
  if (await holds(check.capability.successCondition.condition)) return { kind: 'success' };

  for (const outcome of check.capability.outcomes) {
    if (await holds(outcome.detect)) return { kind: 'outcome', code: outcome.code };
  }

  if (await holds(check.step.postcondition.condition)) return { kind: 'satisfiedByHuman' };

  // A confirm escalation is not a stuck escalation. The person approved one action, so the
  // executor performs it rather than expecting them to have done it.
  if (check.approved) return { kind: 'approved' };

  if (check.step.precondition !== undefined) {
    if (await holds(check.step.precondition.condition)) return { kind: 'retry' };
    return { kind: 'escalate', detail: `The precondition of ${check.step.id} does not hold after the release.` };
  }

  // With no precondition to check, only a step that declares itself repeatable may be run
  // again. Repeating anything else could submit twice, and nobody said it was safe.
  if (check.step.idempotent) return { kind: 'retry' };
  return { kind: 'escalate', detail: `Nothing observed after the release says ${check.step.id} can be repeated safely.` };
}
