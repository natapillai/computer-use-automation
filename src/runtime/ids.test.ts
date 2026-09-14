import { describe, expect, it } from 'vitest';
import { createSequentialIds, systemIds } from './ids.js';

describe('createSequentialIds', () => {
  it('yields the same sequence from two providers built the same way', () => {
    const first = createSequentialIds();
    const second = createSequentialIds();

    const fromFirst = [first.next('run'), first.next('run'), first.next('int')];
    const fromSecond = [second.next('run'), second.next('run'), second.next('int')];

    expect(fromFirst).toEqual(['run_000001', 'run_000002', 'int_000003']);
    expect(fromSecond).toEqual(fromFirst);
  });
});

describe('systemIds', () => {
  it('prefixes every id and does not repeat one', () => {
    const ids = Array.from({ length: 50 }, () => systemIds.next('run'));

    expect(ids.every((id) => id.startsWith('run_'))).toBe(true);
    expect(new Set(ids).size).toBe(50);
  });
});
