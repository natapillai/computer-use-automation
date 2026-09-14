import { describe, expect, it } from 'vitest';
import { readSavingsBalanceFixture } from '../../../tests/fixtures/capabilities/readSavingsBalance.js';
import { parseCapability, type CapabilityParseResult, type LoadIssue } from './load.js';

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`fixture has no item at ${index}`);
  return item;
}

function issuesOf(result: CapabilityParseResult): readonly LoadIssue[] {
  if (result.ok || result.failure !== 'CapabilityInvalid') {
    throw new Error(`expected CapabilityInvalid, got ${JSON.stringify(result).slice(0, 200)}`);
  }
  return result.issues;
}

describe('parseCapability', () => {
  it('parses the hand authored readSavingsBalance fixture and applies defaults', () => {
    const result = parseCapability(readSavingsBalanceFixture());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capability.steps.map((step) => step.id)).toEqual(['openSearch', 'fillMemberId', 'submitSearch', 'openMemberDetail']);
    expect(at([...result.capability.steps], 0).sensitive).toBe(false);
    expect(at([...result.capability.steps], 0).timeoutMs).toBe(15_000);
  });

  it('refuses a future schemaVersion as SchemaIncompatible', () => {
    const artifact = readSavingsBalanceFixture();
    Reflect.set(artifact, 'schemaVersion', '2.0.0');

    expect(parseCapability(artifact)).toEqual({
      ok: false,
      failure: 'SchemaIncompatible',
      detail: 'The artifact declares schemaVersion 2.0.0. This engine supports 1.0.0.',
    });
  });

  it('refuses an artifact with no schemaVersion as SchemaIncompatible', () => {
    const artifact = readSavingsBalanceFixture();
    Reflect.deleteProperty(artifact, 'schemaVersion');

    const result = parseCapability(artifact);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe('SchemaIncompatible');
  });

  it('rejects duplicate step ids', () => {
    const artifact = readSavingsBalanceFixture();
    at(artifact.steps, 1).id = 'openSearch';

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'steps.1.id',
      message: 'Step ids must be unique. "openSearch" appears more than once.',
    });
  });

  it('rejects an index that does not match the step position', () => {
    const artifact = readSavingsBalanceFixture();
    at(artifact.steps, 2).index = 5;

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'steps.2.index',
      message: 'Step "submitSearch" has index 5 at position 2. The index must match the position.',
    });
  });

  it('rejects an output that reads after a step that does not exist', () => {
    const artifact = readSavingsBalanceFixture();
    at(artifact.outputs, 0).source.stepId = 'readBalance';

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'outputs.0.source.stepId',
      message: 'Output "savingsBalance" reads after step "readBalance", which does not exist.',
    });
  });

  it('rejects outputResolvable naming an undeclared output', () => {
    const artifact = readSavingsBalanceFixture();
    artifact.successCondition.condition = { kind: 'outputResolvable', outputName: 'checkingBalance' };

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'successCondition.condition',
      message: 'outputResolvable names "checkingBalance", which is not a declared output.',
    });
  });

  it('rejects a template naming an undeclared input', () => {
    const artifact = readSavingsBalanceFixture();
    at(artifact.steps, 1).value = '{{inputs.memberNumber}}';

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'steps.1.value',
      message: 'Template reference {{inputs.memberNumber}} names no declared input.',
    });
  });

  it('rejects an output template used before the step that extracts it', () => {
    const artifact = readSavingsBalanceFixture();
    at(artifact.steps, 1).value = '{{outputs.savingsBalance}}';

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'steps.1.value',
      message: 'Template reference {{outputs.savingsBalance}} is used before the step that extracts it.',
    });
  });

  it('rejects a step without a postcondition, because a click is never assumed to have worked', () => {
    const artifact = readSavingsBalanceFixture();
    Reflect.deleteProperty(at(artifact.steps, 0), 'postcondition');

    expect(issuesOf(parseCapability(artifact)).map((issue) => issue.path)).toContain('steps.0.postcondition');
  });

  it('rejects a retry on a step that is not idempotent', () => {
    const artifact = readSavingsBalanceFixture();
    at(artifact.steps, 2).retry = { attempts: 2, backoffMs: 500 };

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'steps.2.retry',
      message: 'Step "submitSearch" retries but is not idempotent. Repeating it could submit twice.',
    });
  });

  it('rejects a step level business outcome whose code is not declared', () => {
    const artifact = readSavingsBalanceFixture();
    const rule = at(at(artifact.steps, 2).onCondition ?? [], 0);
    rule.code = 'MEMBER_MISSING';

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'steps.2.onCondition.0.code',
      message: 'Step "submitSearch" classifies "MEMBER_MISSING" as a business outcome, but it is not declared in outcomes.',
    });
  });

  it('rejects a write step in a capability whose maxEffect is read', () => {
    const artifact = readSavingsBalanceFixture();
    at(artifact.steps, 2).effect = 'write';

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'steps.2.effect',
      message: 'Step "submitSearch" writes, but policy.maxEffect is read.',
    });
  });

  it('rejects an element action without a target', () => {
    const artifact = readSavingsBalanceFixture();
    Reflect.deleteProperty(at(artifact.steps, 3), 'target');

    expect(issuesOf(parseCapability(artifact))).toContainEqual({
      path: 'steps.3.target',
      message: 'Step "openMemberDetail" acts on an element and needs a target.',
    });
  });

  it('rejects redactionApplied false, because it is a marker the writer sets', () => {
    const artifact = readSavingsBalanceFixture();
    Reflect.set(artifact.provenance, 'redactionApplied', false);

    expect(issuesOf(parseCapability(artifact)).map((issue) => issue.path)).toContain('provenance.redactionApplied');
  });
});
