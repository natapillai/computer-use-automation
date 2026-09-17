import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { profile, redactor } from '../../tests/fixtures/discovery/fakeRun.js';
import { meridianScript } from '../../tests/fixtures/surface/meridianScreens.js';
import { Capability } from '../core/capability/schema.js';
import type { Observation } from '../core/surfaceModel/types.js';
import { declareOutcome, minorBump, type OutcomeDecision } from './outcomeProbe.js';

// The negative probe review, ADR 0018. A reviewer names the outcome and points at the banner by
// what it says. The detector is derived from that real element, so nobody writes a selector.

const decision: OutcomeDecision = {
  code: 'MEMBER_NOT_FOUND',
  description: 'No member exists with the supplied ID.',
  terminal: true,
  elementText: 'No records found.',
};

function draft(): Capability {
  return Capability.parse(JSON.parse(readFileSync(new URL('../../tests/fixtures/discovery/expectedDraft.json', import.meta.url), 'utf8')));
}

function stopScreen(): Observation {
  const screen = meridianScript({ searchLeadsTo: 'noRecords', memberId: '00000' }).screens['noRecords'];
  if (screen === undefined) throw new Error('The scripted no records screen is missing.');
  return screen;
}

describe('minorBump', () => {
  it('raises the minor and resets the patch, because a review only ever adds an outcome', () => {
    expect([minorBump('1.0.0'), minorBump('1.1.3'), minorBump('2.9.0')]).toEqual(['1.1.0', '1.2.0', '2.10.0']);
  });
});

describe('declareOutcome', () => {
  const context = { inputs: { memberId: '00000' }, profile, redactor };

  it('derives the detector from the real banner and emits a minor bump the reviewer never wrote', () => {
    const declared = declareOutcome(draft(), stopScreen(), decision, context);
    if (!declared.ok) throw new Error(`The probe failed with ${declared.failure}.`);

    expect(declared.capability.version).toBe('1.1.0');
    expect(declared.capability.outcomes).toHaveLength(1);
    expect(declared.capability.outcomes[0]).toMatchObject({ code: 'MEMBER_NOT_FOUND', terminal: true, provenance: 'manual', detect: { kind: 'elementPresent' } });
    expect(declared.detector.strategies.length).toBeGreaterThan(0);
    expect(declared.capability.provenance.derivedFrom).toEqual({ id: 'member.readSavingsBalance', version: '1.0.0' });
    expect(declared.capability.lifecycle.status).toBe('draft');
    expect(declared.capability.steps).toEqual(draft().steps);
  });

  it('refuses when nothing on the screen carries the text, and when more than one element does', () => {
    expect(declareOutcome(draft(), stopScreen(), { ...decision, elementText: 'Account restricted' }, context)).toMatchObject({ ok: false, failure: 'NoMatchingElement' });
    expect(declareOutcome(draft(), stopScreen(), { ...decision, elementText: 'Member' }, context)).toMatchObject({ ok: false, failure: 'AmbiguousElement' });
  });

  it('refuses a code the capability already declares', () => {
    const declared = declareOutcome(draft(), stopScreen(), decision, context);
    if (!declared.ok) throw new Error('The first declaration failed.');

    expect(declareOutcome(declared.capability, stopScreen(), decision, context)).toMatchObject({ ok: false, failure: 'OutcomeAlreadyDeclared' });
  });

  it('never repeats the text it was given in a refusal, because a banner can carry member data', () => {
    const refusal = declareOutcome(draft(), stopScreen(), { ...decision, elementText: 'Test Member One' }, context);

    expect(refusal.ok).toBe(false);
    expect(JSON.stringify(refusal)).not.toContain('Test Member One');
  });
});
