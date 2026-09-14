import type { LocatorBundle, LocatorStrategy } from './schema.js';

export type StrategyKind = LocatorStrategy['kind'];

// The driver port. Given one strategy and a frame path, return the refs it matches in
// the current observation. Ordering, ambiguity and drift are decided here, in core,
// so every driver resolves a bundle the same way.
export type StrategyMatcher = (strategy: LocatorStrategy, framePath: readonly string[]) => Promise<readonly string[]>;

export interface LocatorAttempt {
  readonly strategyIndex: number;
  readonly kind: StrategyKind;
  readonly outcome: 'matched' | 'not_found' | 'ambiguous';
  readonly matchCount: number;
}

export interface DriftRecord {
  readonly describedAs: string;
  readonly preferredKind: StrategyKind;
  readonly winningKind: StrategyKind;
  readonly winningIndex: number;
  readonly attempts: readonly LocatorAttempt[];
}

export type Resolution =
  | {
      readonly ok: true;
      readonly ref: string;
      readonly attempts: readonly LocatorAttempt[];
      readonly drift: DriftRecord | null;
    }
  | {
      readonly ok: false;
      readonly failure: 'LocatorNotFound' | 'LocatorAmbiguous';
      readonly describedAs: string;
      readonly attempts: readonly LocatorAttempt[];
    };

export async function resolveBundle(bundle: LocatorBundle, match: StrategyMatcher): Promise<Resolution> {
  const attempts: LocatorAttempt[] = [];

  for (const [strategyIndex, strategy] of bundle.strategies.entries()) {
    const refs = await match(strategy, bundle.framePath);
    const winner = pick(bundle, refs);
    attempts.push({ strategyIndex, kind: strategy.kind, outcome: outcomeOf(bundle, refs, winner), matchCount: refs.length });

    if (winner !== undefined) {
      const recorded = [...attempts];
      const preferred = bundle.strategies[0];
      const drift =
        strategyIndex === 0 || preferred === undefined
          ? null
          : {
              describedAs: bundle.describedAs,
              preferredKind: preferred.kind,
              winningKind: strategy.kind,
              winningIndex: strategyIndex,
              attempts: recorded,
            };
      return { ok: true, ref: winner, attempts: recorded, drift };
    }
  }

  // A strategy that matched several nodes is the more dangerous signal. The element
  // exists and cannot be told apart, which is a recording quality bug rather than drift.
  const anyAmbiguous = attempts.some((attempt) => attempt.outcome === 'ambiguous');
  return {
    ok: false,
    failure: anyAmbiguous ? 'LocatorAmbiguous' : 'LocatorNotFound',
    describedAs: bundle.describedAs,
    attempts,
  };
}

function pick(bundle: LocatorBundle, refs: readonly string[]): string | undefined {
  if (bundle.matchPolicy === 'unique') {
    return refs.length === 1 ? refs[0] : undefined;
  }
  return refs[bundle.nth ?? 0];
}

function outcomeOf(bundle: LocatorBundle, refs: readonly string[], winner: string | undefined): LocatorAttempt['outcome'] {
  if (winner !== undefined) return 'matched';
  return bundle.matchPolicy === 'unique' && refs.length > 1 ? 'ambiguous' : 'not_found';
}
