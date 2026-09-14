import type { AnchorStrategy, LocatorBundle, LocatorStrategy } from '../locator/schema.js';
import type { ConditionMatcher } from '../outcome/condition.js';
import type { CapabilityShape } from './schema.js';
import { scanTemplate } from './template.js';

export interface CapabilityIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

type Path = readonly (string | number)[];

// Rules that relate one field of a capability to another, which structure alone cannot
// express. A pure function, so every rule is testable without Zod in the way.
export function capabilityIssues(capability: CapabilityShape): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  const report = (path: Path, message: string): void => {
    issues.push({ path, message });
  };

  const stepPositionById = new Map<string, number>();
  capability.steps.forEach((step, position) => {
    if (stepPositionById.has(step.id)) {
      report(['steps', position, 'id'], `Step ids must be unique. "${step.id}" appears more than once.`);
    } else {
      stepPositionById.set(step.id, position);
    }
    if (step.index !== position) {
      report(
        ['steps', position, 'index'],
        `Step "${step.id}" has index ${step.index} at position ${position}. The index must match the position.`,
      );
    }
  });

  const inputNames = new Set(capability.inputs.map((input) => input.name));
  const outcomeCodes = new Set(capability.outcomes.map((outcome) => outcome.code));

  const outputSourcePosition = new Map<string, number | undefined>();
  capability.outputs.forEach((output, i) => {
    const position = stepPositionById.get(output.source.stepId);
    outputSourcePosition.set(output.name, position);
    if (position === undefined) {
      report(
        ['outputs', i, 'source', 'stepId'],
        `Output "${output.name}" reads after step "${output.source.stepId}", which does not exist.`,
      );
    }
  });

  // availableBefore is the position of the step a template sits in. An output can only
  // be referenced by a step after the one it is read from. null means anywhere.
  const checkText = (text: string, path: Path, availableBefore: number | null): void => {
    const scan = scanTemplate(text);
    for (const body of scan.malformed) {
      report(path, `Template reference {{${body}}} is not inputs, outputs or env followed by a name.`);
    }
    for (const reference of scan.references) {
      if (reference.scope === 'inputs' && !inputNames.has(reference.name)) {
        report(path, `Template reference {{inputs.${reference.name}}} names no declared input.`);
      }
      if (reference.scope !== 'outputs') continue;
      if (!outputSourcePosition.has(reference.name)) {
        report(path, `Template reference {{outputs.${reference.name}}} names no declared output.`);
        continue;
      }
      const source = outputSourcePosition.get(reference.name);
      if (availableBefore !== null && (source === undefined || source >= availableBefore)) {
        report(path, `Template reference {{outputs.${reference.name}}} is used before the step that extracts it.`);
      }
    }
  };

  const checkBundle = (bundle: LocatorBundle, path: Path, availableBefore: number | null): void => {
    bundle.strategies.forEach((strategy, i) => {
      for (const text of strategyTexts(strategy)) checkText(text, [...path, 'strategies', i], availableBefore);
    });
  };

  const checkCondition = (condition: ConditionMatcher, path: Path, availableBefore: number | null): void => {
    switch (condition.kind) {
      case 'elementPresent':
        checkBundle(condition.target, [...path, 'target'], availableBefore);
        return;
      case 'textMatches':
        checkBundle(condition.target, [...path, 'target'], availableBefore);
        checkText(condition.pattern, [...path, 'pattern'], availableBefore);
        return;
      case 'urlMatches':
        checkText(condition.pattern, [...path, 'pattern'], availableBefore);
        return;
      case 'outputResolvable':
        if (!outputSourcePosition.has(condition.outputName)) {
          report(path, `outputResolvable names "${condition.outputName}", which is not a declared output.`);
        }
        return;
      case 'all':
      case 'any':
        condition.of.forEach((child, i) => checkCondition(child, [...path, 'of', i], availableBefore));
        return;
      case 'not':
        checkCondition(condition.of, [...path, 'of'], availableBefore);
        return;
      case 'httpStatus':
      case 'dialogPresent':
        return;
    }
  };

  capability.steps.forEach((step, position) => {
    const stepPath = (...rest: (string | number)[]): Path => ['steps', position, ...rest];
    const navigates = step.action.kind === 'navigate';

    if (navigates && step.target !== undefined) {
      report(stepPath('target'), `Step "${step.id}" navigates and must not have a target.`);
    }
    if (!navigates && step.target === undefined) {
      report(stepPath('target'), `Step "${step.id}" acts on an element and needs a target.`);
    }
    if ((step.action.kind === 'fill' || step.action.kind === 'select') && step.value === undefined) {
      report(stepPath('value'), `Step "${step.id}" needs a value to ${step.action.kind}.`);
    }
    if (step.retry.attempts > 0 && !step.idempotent) {
      report(stepPath('retry'), `Step "${step.id}" retries but is not idempotent. Repeating it could submit twice.`);
    }
    if (step.effect === 'write' && capability.policy.maxEffect === 'read') {
      report(stepPath('effect'), `Step "${step.id}" writes, but policy.maxEffect is read.`);
    }

    if (step.action.kind === 'navigate') checkText(step.action.path, stepPath('action', 'path'), position);
    if (step.value !== undefined) checkText(step.value, stepPath('value'), position);
    if (step.target !== undefined) checkBundle(step.target, stepPath('target'), position);
    if (step.precondition !== undefined) {
      checkCondition(step.precondition.condition, stepPath('precondition', 'condition'), position);
    }
    checkCondition(step.postcondition.condition, stepPath('postcondition', 'condition'), position);

    step.onCondition.forEach((rule, i) => {
      checkCondition(rule.when, stepPath('onCondition', i, 'when'), position);
      if (rule.classify === 'business_outcome' && !outcomeCodes.has(rule.code)) {
        report(
          stepPath('onCondition', i, 'code'),
          `Step "${step.id}" classifies "${rule.code}" as a business outcome, but it is not declared in outcomes.`,
        );
      }
    });
  });

  capability.outputs.forEach((output, i) => checkBundle(output.source.target, ['outputs', i, 'source', 'target'], null));
  capability.outcomes.forEach((outcome, i) => checkCondition(outcome.detect, ['outcomes', i, 'detect'], null));
  checkCondition(capability.successCondition.condition, ['successCondition', 'condition'], null);

  return issues;
}

function strategyTexts(strategy: LocatorStrategy): string[] {
  switch (strategy.kind) {
    case 'role-name':
      return [strategy.name];
    case 'label':
    case 'text':
      return [strategy.text];
    case 'test-id':
      return [strategy.value];
    case 'structural':
      return [strategy.path];
    case 'anchor-relative':
      return anchorTexts(strategy.anchor);
  }
}

function anchorTexts(anchor: AnchorStrategy): string[] {
  return anchor.kind === 'role-name' ? [anchor.name] : [anchor.text];
}
