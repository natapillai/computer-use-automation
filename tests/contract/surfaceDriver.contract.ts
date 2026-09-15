import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ControlLostError, type ControlToken, type SessionControlTokens } from '../../src/control/controlToken.js';
import type { LocatorBundle, LocatorStrategy } from '../../src/core/locator/schema.js';
import { sameFramePath } from '../../src/core/surfaceModel/geometry.js';
import { findNodeByRef, walkNodes } from '../../src/core/surfaceModel/tree.js';
import type { SurfaceDriver } from '../../src/surface/types.js';

export interface ContractSubject {
  readonly driver: SurfaceDriver;
  readonly tokens: SessionControlTokens;
  close(): Promise<void>;
}

function bundle(describedAs: string, strategies: LocatorStrategy[], framePath: string[] = ['content']): LocatorBundle {
  return { framePath, strategies, matchPolicy: 'unique', describedAs };
}

// The definition of the seam, see docs/TESTING.md section 5 and ARCHITECTURE section 3.
// Every SurfaceDriver runs this against MERIDIAN Core's member search page, the web driver
// on the live app and the fake on its scripted copy. A fake that drifts from the real
// driver fails here rather than in a test that trusted it.
export function surfaceDriverContract(name: string, factory: () => Promise<ContractSubject>): void {
  describe(`SurfaceDriver contract: ${name}`, () => {
    let subject: ContractSubject;
    let token: ControlToken;

    beforeEach(async () => {
      subject = await factory();
      token = subject.tokens.issue('automation');
      expect(await subject.driver.act({ kind: 'navigate', path: '/servicing', framePath: [] }, token)).toEqual({ ok: true });
      expect(await subject.driver.act({ kind: 'navigate', path: '/servicing/search', framePath: ['content'] }, token)).toEqual({ ok: true });
    });

    afterEach(() => subject.close());

    it('observes the search form with unique refs and reports the frame url', async () => {
      const refs = [...walkNodes((await subject.driver.observe()).root)].map((node) => node.ref);

      expect(new Set(refs).size).toBe(refs.length);
      expect(await subject.driver.frameUrl(['content'])).toMatch(/\/servicing\/search$/);
      expect(await subject.driver.frameUrl(['missing'])).toBeNull();
    });

    it('attaches a derived label to each input that has no accessible name', async () => {
      const inputs = [...walkNodes((await subject.driver.observe()).root)].filter(
        (node) => node.role === 'textbox' && sameFramePath(node.framePath, ['content']),
      );

      expect(inputs.map((node) => [node.name, node.derivedLabel])).toEqual([
        ['', 'Member ID:'],
        ['', 'Surname:'],
      ]);
    });

    it('resolves a bundle that matches nothing to LocatorNotFound with every attempt', async () => {
      const resolution = await subject.driver.resolve(
        bundle('Relabelled field', [{ kind: 'text', text: 'Account Holder ID:', exact: true, confidence: 0.8 }]),
        token,
      );

      expect(resolution).toMatchObject({ ok: false, failure: 'LocatorNotFound', attempts: [{ outcome: 'not_found', matchCount: 0 }] });
    });

    it('rejects a strategy that matches several nodes under the unique policy', async () => {
      const resolution = await subject.driver.resolve(
        bundle('Any textbox', [{ kind: 'role-name', role: 'textbox', name: '', exact: false, confidence: 0.5 }]),
        token,
      );

      expect(resolution).toMatchObject({ ok: false, failure: 'LocatorAmbiguous', attempts: [{ outcome: 'ambiguous', matchCount: 2 }] });
    });

    it('scopes resolution to the frame path', async () => {
      const navLink: LocatorStrategy = { kind: 'role-name', role: 'link', name: 'Member Search', exact: true, confidence: 0.9 };

      expect(await subject.driver.resolve(bundle('Nav link', [navLink], ['nav']), token)).toMatchObject({ ok: true });
      expect(await subject.driver.resolve(bundle('Nav link', [navLink], ['content']), token)).toMatchObject({ ok: false, failure: 'LocatorNotFound' });
    });

    it('resolves a geometric relation to the input beside its label', async () => {
      const resolution = await subject.driver.resolve(
        bundle('Surname input', [
          {
            kind: 'anchor-relative',
            anchor: { kind: 'text', text: 'Surname:', exact: true, confidence: 0.8 },
            relation: 'sameRow',
            role: 'textbox',
            confidence: 0.8,
          },
        ]),
        token,
      );

      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;
      expect(findNodeByRef((await subject.driver.observe()).root, resolution.ref)?.derivedLabel).toBe('Surname:');
    });

    it('rejects a stale control token before resolving or acting', async () => {
      subject.tokens.issue('human');

      await expect(subject.driver.resolve(bundle('Search button', [{ kind: 'role-name', role: 'cell', name: 'Search', exact: true, confidence: 0.7 }]), token)).rejects.toBeInstanceOf(ControlLostError);
      await expect(subject.driver.act({ kind: 'navigate', path: '/member/10001', framePath: ['content'] }, token)).rejects.toBeInstanceOf(ControlLostError);
      expect(await subject.driver.frameUrl(['content'])).toMatch(/\/servicing\/search$/);
    });

    it('times out when nothing changes and reports a change after an action', async () => {
      await subject.driver.observe();
      expect(await subject.driver.waitForChange(300)).toBe('timeout');

      const search = await subject.driver.resolve(bundle('Search button', [{ kind: 'role-name', role: 'cell', name: 'Search', exact: true, confidence: 0.7 }]), token);
      expect(search.ok).toBe(true);
      if (!search.ok) return;
      expect(await subject.driver.act({ kind: 'click', ref: search.ref }, token)).toEqual({ ok: true });
      expect(await subject.driver.waitForChange(10_000)).toBe('changed');
    });
  });
}
