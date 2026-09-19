import { describe, expect, it } from 'vitest';
import { LocatorBundle } from './schema.js';
import { resolveBundle, type StrategyMatcher } from './resolve.js';

const roleName = { kind: 'role-name', role: 'textbox', name: 'Member ID', exact: true, confidence: 0.9 };
const anchorRelative = {
  kind: 'anchor-relative',
  anchor: { kind: 'text', text: 'Member ID:', exact: false, confidence: 0.8 },
  relation: 'sameRow',
  role: 'textbox',
  confidence: 0.8,
};
const structural = { kind: 'structural', path: 'form#srch >> input', confidence: 0.4 };

function memberIdBundle(overrides: Record<string, unknown> = {}): LocatorBundle {
  return LocatorBundle.parse({
    framePath: ['content'],
    strategies: [roleName, anchorRelative, structural],
    matchPolicy: 'unique',
    describedAs: 'Member ID input',
    ...overrides,
  });
}

// A matcher scripted by strategy kind, recording every frame path it was asked about.
function scripted(results: Partial<Record<string, readonly string[]>>, framesSeen: string[][] = []): StrategyMatcher {
  return async (strategy, framePath) => {
    framesSeen.push([...framePath]);
    return results[strategy.kind] ?? [];
  };
}

describe('resolveBundle', () => {
  it('resolves through the first strategy that matches exactly one node, with no drift', async () => {
    const resolution = await resolveBundle(memberIdBundle(), scripted({ 'role-name': ['n4'], 'anchor-relative': ['n4'] }));

    expect(resolution).toEqual({
      ok: true,
      ref: 'n4',
      attempts: [{ strategyIndex: 0, kind: 'role-name', outcome: 'matched', matchCount: 1 }],
      drift: null,
    });
  });

  it('stops on an ambiguous strategy under a unique policy rather than letting a later one guess', async () => {
    const resolution = await resolveBundle(
      memberIdBundle(),
      scripted({ 'role-name': ['n4', 'n9'], 'anchor-relative': ['n4'] }),
    );

    // ADR 0019. Two nodes match the description the recording was made against, so the page
    // holds two things it cannot tell apart. A later strategy resolving one of them is a guess,
    // and on this surface the guess is which member record to open.
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.failure).toBe('LocatorAmbiguous');
    expect(resolution.attempts).toEqual([{ strategyIndex: 0, kind: 'role-name', outcome: 'ambiguous', matchCount: 2 }]);
  });

  it('still falls through when a strategy simply does not match, which is drift', async () => {
    const resolution = await resolveBundle(memberIdBundle(), scripted({ 'role-name': [], 'anchor-relative': ['n4'] }));

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.ref).toBe('n4');
    expect(resolution.drift).toMatchObject({ preferredKind: 'role-name', winningKind: 'anchor-relative', winningIndex: 1 });
  });

  it('fails as LocatorAmbiguous on the first strategy that matches more than one node', async () => {
    const resolution = await resolveBundle(
      memberIdBundle(),
      scripted({ 'role-name': ['n4', 'n9'], 'anchor-relative': ['n4', 'n9'], structural: ['n4', 'n9'] }),
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.failure).toBe('LocatorAmbiguous');
    // One attempt, not three. The later strategies are not tried, because the page has already
    // shown it carries two of the thing the bundle describes.
    expect(resolution.attempts.map((attempt) => attempt.outcome)).toEqual(['ambiguous']);
  });

  it('fails as LocatorNotFound listing every attempted strategy when nothing matches', async () => {
    const resolution = await resolveBundle(memberIdBundle(), scripted({}));

    expect(resolution).toEqual({
      ok: false,
      failure: 'LocatorNotFound',
      describedAs: 'Member ID input',
      attempts: [
        { strategyIndex: 0, kind: 'role-name', outcome: 'not_found', matchCount: 0 },
        { strategyIndex: 1, kind: 'anchor-relative', outcome: 'not_found', matchCount: 0 },
        { strategyIndex: 2, kind: 'structural', outcome: 'not_found', matchCount: 0 },
      ],
    });
  });

  it('reports LocatorAmbiguous when no strategy wins and at least one was ambiguous', async () => {
    const resolution = await resolveBundle(memberIdBundle(), scripted({ 'anchor-relative': ['n4', 'n9'] }));

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.failure).toBe('LocatorAmbiguous');
  });

  it('takes the nth match under an nth policy', async () => {
    const resolution = await resolveBundle(
      memberIdBundle({ matchPolicy: 'nth', nth: 1 }),
      scripted({ 'role-name': ['n1', 'n2', 'n3'] }),
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.ref).toBe('n2');
  });

  it('asks the matcher about the frame path the bundle declares', async () => {
    const framesSeen: string[][] = [];

    await resolveBundle(memberIdBundle(), scripted({ 'role-name': ['n4'] }, framesSeen));

    expect(framesSeen).toEqual([['content']]);
  });
});
