import { describe, expect, it } from 'vitest';
import type { ControlToken } from '../../control/controlToken.js';
import type { LocatorBundle } from '../../core/locator/schema.js';
import { ACTION_VERBS } from '../../core/surfaceModel/types.js';
import type { SurfaceDriver } from '../types.js';
import { createDesktopSurfaceDriver, NotImplementedError } from './desktopSurfaceDriver.js';

// S7-T01. The seam is the claim that this system is not a browser automation tool wearing a
// different name, and a stub is how that claim is checked without building a second driver.
// It satisfies the interface, so the compiler proves the seam holds, and every verb throws a
// named error, so nothing can quietly half work.

const control: ControlToken = { sessionId: 'sess_desktop', holder: 'automation', value: 'ctl_000001' };
const bundle: LocatorBundle = { framePath: [], strategies: [], matchPolicy: 'unique', describedAs: 'a control' };

describe('createDesktopSurfaceDriver', () => {
  const driver: SurfaceDriver = createDesktopSurfaceDriver({ sessionId: 'sess_desktop' });

  it('satisfies the surface driver interface and says which surface it is', () => {
    expect(driver.kind).toBe('desktop');
    expect(driver.sessionId).toBe('sess_desktop');
  });

  it('refuses every method by name rather than returning something empty', async () => {
    const calls: [string, Promise<unknown>][] = [
      ['observe', driver.observe()],
      ['match', driver.match({ kind: 'text', text: 'Member ID', exact: true, confidence: 1 }, [])],
      ['frameUrl', driver.frameUrl([])],
      ['waitForChange', driver.waitForChange(100)],
      ['screenshot', driver.screenshot([])],
      ['resolve', driver.resolve(bundle, control)],
      ['act', driver.act({ kind: 'click', ref: 'n1' }, control)],
    ];

    for (const [name, call] of calls) {
      // A stub that returned an empty observation would let a run get several steps in before
      // failing somewhere that says nothing about why.
      await expect(call, name).rejects.toThrow(NotImplementedError);
      await expect(call, name).rejects.toThrow(new RegExp(name));
    }
  });

  it('closes without throwing, because releasing nothing is not an unimplemented feature', async () => {
    await expect(driver.close()).resolves.toBeUndefined();
  });

  it('documents a UI Automation mapping for every action verb the vocabulary has', () => {
    const mapping = createDesktopSurfaceDriver({ sessionId: 'sess_desktop' }).mapping;

    // The vocabulary is shared by both surfaces, so a verb with no documented mapping is a
    // verb this seam has not actually been thought through for.
    expect(Object.keys(mapping).sort()).toEqual([...ACTION_VERBS].sort());
    for (const [verb, note] of Object.entries(mapping)) expect(note.length, verb).toBeGreaterThan(20);
  });
});
