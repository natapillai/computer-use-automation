import { describe, expect, it } from 'vitest';
import { asReference, looksLikeMachinePath } from './paths.js';

// Every path a command prints or persists is one a reader might paste into a ticket. The first
// live run put an absolute path with a username into the log, which was fixed there and stayed
// in stdout, and the second live run found it again. So the rule now has a function and a test
// rather than a habit.

describe('looksLikeMachinePath', () => {
  it('recognises the shapes that carry a username or a machine layout', () => {
    expect(looksLikeMachinePath('C:\\Users\\natap\\Projects\\thing\\evidence')).toBe(true);
    expect(looksLikeMachinePath('/home/natap/projects/thing/evidence')).toBe(true);
    expect(looksLikeMachinePath('/Users/natap/projects/thing')).toBe(true);
    expect(looksLikeMachinePath('D:/work/evidence/discovery/run_1')).toBe(true);
    expect(looksLikeMachinePath('/var/folders/xy/T/discover-abc/evidence')).toBe(true);
  });

  it('leaves a relative reference alone, because that is what a command is allowed to print', () => {
    expect(looksLikeMachinePath('evidence/discovery/run_000001')).toBe(false);
    expect(looksLikeMachinePath('capabilities/member.readSavingsBalance@1.0.0.json')).toBe(false);
  });
});

describe('asReference', () => {
  it('keeps the root the caller asked for and drops nothing else', () => {
    expect(asReference('evidence', 'discovery', 'run_000001')).toBe('evidence/discovery/run_000001');
  });

  it('never returns a machine path, whatever root it is given', () => {
    // A caller who passes an absolute evidence root gets a reference relative to it, because
    // the part worth printing is where the run is, not where their home directory is.
    const reference = asReference('C:\\Users\\natap\\scratch\\evidence', 'replay', 'run_000001');

    expect(looksLikeMachinePath(reference)).toBe(false);
    expect(reference).toBe('evidence/replay/run_000001');
  });

  it('uses forward slashes so the same reference reads the same on every machine', () => {
    expect(asReference('out\\evidence', 'review', 'run_000001')).toBe('evidence/review/run_000001');
  });
});
