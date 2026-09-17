import { evaluateCondition } from '../core/outcome/evaluate.js';
import type { StrategyMatcher } from '../core/locator/resolve.js';
import type { ConditionMatcher } from '../core/outcome/condition.js';
import type { Observation } from '../core/surfaceModel/types.js';

// The one detector that fires in both phases, see docs/ESCALATION.md section 3. A dialog nobody
// declared means the system does not know what to do next, and clicking it to find out is what
// a back office automation must never do. Every rule that could claim it is passed in together,
// step rules, capability outcomes and app profile conditions, because any of them recognising
// the dialog means it is classified.

export interface DialogClaim {
  readonly observation: Observation;
  readonly conditions: readonly ConditionMatcher[];
  readonly match: StrategyMatcher;
  readonly outputResolvable?: (outputName: string) => Promise<boolean>;
}

export async function unclassifiedDialog(claim: DialogClaim): Promise<boolean> {
  if (!claim.observation.dialogOpen) return false;

  for (const condition of claim.conditions) {
    const evaluation = await evaluateCondition(condition, {
      observation: claim.observation,
      match: claim.match,
      outputResolvable: claim.outputResolvable ?? (async () => false),
    });
    if (evaluation.holds) return false;
  }
  return true;
}
