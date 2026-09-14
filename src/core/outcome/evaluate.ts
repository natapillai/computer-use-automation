import { resolveBundle, type StrategyMatcher } from '../locator/resolve.js';
import type { LocatorBundle } from '../locator/schema.js';
import { findNodeByRef } from '../surfaceModel/tree.js';
import type { Observation } from '../surfaceModel/types.js';
import type { ConditionMatcher } from './condition.js';

export interface EvaluationContext {
  readonly observation: Observation;
  readonly match: StrategyMatcher;
  readonly outputResolvable: (outputName: string) => Promise<boolean>;
}

// detail says what was observed in words a checkpoint failure can carry. It names the
// target by its describedAs and never repeats page text, which may be a member's data.
export interface Evaluation {
  readonly holds: boolean;
  readonly detail: string;
}

const held = (detail: string): Evaluation => ({ holds: true, detail });
const failed = (detail: string): Evaluation => ({ holds: false, detail });

export async function evaluateCondition(condition: ConditionMatcher, context: EvaluationContext): Promise<Evaluation> {
  switch (condition.kind) {
    case 'elementPresent': {
      const resolution = await resolveBundle(condition.target, context.match);
      return resolution.ok
        ? held(`${condition.target.describedAs} is present.`)
        : failed(`${condition.target.describedAs} did not resolve.`);
    }

    case 'textMatches': {
      const text = await textOf(condition.target, context);
      if (text === null) return failed(`${condition.target.describedAs} did not resolve.`);
      const pattern = compile(condition.pattern);
      if (pattern === null) return failed(`${condition.target.describedAs} has a pattern that is not a valid regular expression.`);
      return pattern.test(text)
        ? held(`${condition.target.describedAs} matched.`)
        : failed(`${condition.target.describedAs} did not match the expected pattern.`);
    }

    case 'urlMatches': {
      const pattern = compile(condition.pattern);
      if (pattern === null) return failed('The URL pattern is not a valid regular expression.');
      return context.observation.frames.some((frame) => pattern.test(frame.url))
        ? held('A frame URL matched.')
        : failed('No frame URL matched.');
    }

    case 'httpStatus': {
      const status = context.observation.frames.find(
        (frame) => frame.lastStatus !== null && condition.codes.includes(frame.lastStatus),
      )?.lastStatus;
      return status === undefined || status === null
        ? failed(`No frame returned status ${condition.codes.join(' or ')}.`)
        : held(`A frame returned status ${status}.`);
    }

    case 'dialogPresent':
      return context.observation.dialogOpen ? held('A dialog is open.') : failed('No dialog is open.');

    case 'outputResolvable':
      return (await context.outputResolvable(condition.outputName))
        ? held(`Output ${condition.outputName} can be read.`)
        : failed(`Output ${condition.outputName} cannot be read.`);

    case 'all': {
      for (const child of condition.of) {
        const result = await evaluateCondition(child, context);
        if (!result.holds) return result;
      }
      return held('All conditions held.');
    }

    case 'any': {
      for (const child of condition.of) {
        const result = await evaluateCondition(child, context);
        if (result.holds) return result;
      }
      return failed('No condition held.');
    }

    case 'not': {
      const result = await evaluateCondition(condition.of, context);
      return result.holds ? failed(`A condition that should not hold did. ${result.detail}`) : held('The negated condition did not hold.');
    }
  }
}

// A field is judged by its value and anything else by its accessible name.
async function textOf(target: LocatorBundle, context: EvaluationContext): Promise<string | null> {
  const resolution = await resolveBundle(target, context.match);
  if (!resolution.ok) return null;
  const node = findNodeByRef(context.observation.root, resolution.ref);
  if (node === null) return null;
  return node.value ?? node.name;
}

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
