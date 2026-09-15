import { describe, expect, it } from 'vitest';
import profileJson from '../../../profiles/meridian-core.json' with { type: 'json' };
import { meridianScript, type MeridianScriptOptions } from '../../../tests/fixtures/surface/meridianScreens.js';
import { AppProfile, sensitiveFields } from '../policy/profile.js';
import { createRedactor } from '../redaction/redactor.js';
import { walkNodes } from '../surfaceModel/tree.js';
import type { Observation } from '../surfaceModel/types.js';
import { deriveBundle, type DerivationContext } from './derive.js';
import type { LocatorStrategy } from './schema.js';

const profile = AppProfile.parse(profileJson);
const redactor = createRedactor({
  neverPersist: [],
  redactPatterns: [{ name: 'cardNumber', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', flags: 'g', validator: 'luhn' }],
});

function screen(name: string, options: MeridianScriptOptions = {}): Observation {
  const observation = meridianScript(options).screens[name];
  if (observation === undefined) throw new Error(`The scripted screen ${name} is missing.`);
  return observation;
}

function contextFor(observation: Observation): DerivationContext {
  return {
    inputs: { memberId: '10001' },
    sensitive: sensitiveFields(profile, observation),
    redacts: (text) => redactor.text(text, { known: [] }) !== text,
  };
}

function texts(strategy: LocatorStrategy): string[] {
  switch (strategy.kind) {
    case 'role-name':
      return [strategy.name];
    case 'label':
    case 'text':
      return [strategy.text];
    case 'anchor-relative':
      return texts(strategy.anchor);
    case 'test-id':
      return [strategy.value];
    case 'structural':
      return [strategy.path];
  }
}

describe('deriveBundle', () => {
  it('derives anchor relative and label strategies for an unnamed input, and no role-name strategy', () => {
    const search = screen('search');
    const derived = deriveBundle(search, 'n3', contextFor(search));

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.bundle).toMatchObject({ framePath: ['content'], matchPolicy: 'unique' });
    expect(derived.bundle.strategies).toContainEqual(
      expect.objectContaining({ kind: 'anchor-relative', anchor: expect.objectContaining({ kind: 'text', text: 'Member ID:' }), relation: 'sameRow', role: 'textbox' }),
    );
    expect(derived.bundle.strategies).toContainEqual(expect.objectContaining({ kind: 'label', text: 'Member ID:' }));
    expect(derived.bundle.strategies.map((strategy) => strategy.kind)).not.toContain('role-name');
  });

  it('orders the strategies it kept from most to least confident', () => {
    const search = screen('search');
    const derived = deriveBundle(search, 'n3', contextFor(search));

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const confidences = derived.bundle.strategies.map((strategy) => strategy.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
  });

  it('keeps a strategy only when it matches exactly the element, and drops an ambiguous one with the reason', () => {
    const duplicated = screen('search', { duplicateSearchButton: true });
    const derived = deriveBundle(duplicated, 'n6', contextFor(duplicated));

    expect(derived).toMatchObject({ ok: false, failure: 'NoUniqueStrategy' });
    expect(derived.dropped).toContainEqual(expect.objectContaining({ strategy: expect.objectContaining({ kind: 'text' }), reason: 'ambiguous' }));
    expect(derived.dropped).toContainEqual(expect.objectContaining({ strategy: expect.objectContaining({ kind: 'role-name' }), reason: 'ambiguous' }));

    const single = screen('search');
    const kept = deriveBundle(single, 'n6', contextFor(single));
    expect(kept.ok && kept.bundle.strategies.map((strategy) => strategy.kind)).toEqual(expect.arrayContaining(['role-name', 'text']));
  });

  it('writes a member id as its template and never as a literal', () => {
    const results = screen('results');
    const derived = deriveBundle(results, 'r1', contextFor(results));

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.bundle.strategies).toContainEqual(expect.objectContaining({ kind: 'role-name', role: 'link', name: '{{inputs.memberId}}' }));
    expect(derived.bundle.describedAs).toContain('{{inputs.memberId}}');
    expect(JSON.stringify(derived)).not.toContain('10001');
  });

  it('drops text that shows member data, and anchors the value on its row label instead', () => {
    const detail = screen('detail');
    const derived = deriveBundle(detail, 's3', contextFor(detail));

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.bundle.strategies).toContainEqual(
      expect.objectContaining({ kind: 'anchor-relative', anchor: expect.objectContaining({ text: 'Savings' }), relation: 'rightOf', role: 'cell' }),
    );
    expect(derived.dropped).toContainEqual(expect.objectContaining({ reason: 'sensitive' }));
    expect(JSON.stringify(derived)).not.toMatch(/4,250\.75|Test Member One/);
  });

  it('uses no text that is not on the page, other than an input template', () => {
    const detail = screen('detail');
    const onPage = new Set([...walkNodes(detail.root)].flatMap((node) => [node.name, node.derivedLabel ?? '']).map((text) => text.replace(/\s+/g, ' ').trim()));

    for (const ref of ['d1', 's2', 's3', 'h1']) {
      const derived = deriveBundle(detail, ref, contextFor(detail));
      if (!derived.ok) continue;
      for (const text of derived.bundle.strategies.flatMap(texts)) {
        expect(onPage.has(text) || text === '{{inputs.memberId}}', `${ref} used "${text}"`).toBe(true);
      }
    }
  });
});
