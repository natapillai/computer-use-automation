import { z } from 'zod';
import { LocatorBundle } from '../locator/schema.js';

// The one matcher language. Checkpoints, preconditions, postconditions, success
// conditions and outcome detectors all use it. See docs/ERROR_TAXONOMY.md section 5.
export type ConditionMatcher =
  | { readonly kind: 'elementPresent'; readonly target: LocatorBundle }
  | { readonly kind: 'textMatches'; readonly target: LocatorBundle; readonly pattern: string }
  | { readonly kind: 'urlMatches'; readonly pattern: string }
  | { readonly kind: 'httpStatus'; readonly codes: readonly number[] }
  | { readonly kind: 'dialogPresent' }
  | { readonly kind: 'outputResolvable'; readonly outputName: string }
  | { readonly kind: 'all'; readonly of: readonly ConditionMatcher[] }
  | { readonly kind: 'any'; readonly of: readonly ConditionMatcher[] }
  | { readonly kind: 'not'; readonly of: ConditionMatcher };

// Recursive, so this type is written out and the schema is annotated with it. Every
// other schema in the capability infers its type from Zod.
export const ConditionMatcher: z.ZodType<ConditionMatcher> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('elementPresent'), target: LocatorBundle }),
    z.strictObject({ kind: z.literal('textMatches'), target: LocatorBundle, pattern: z.string().min(1) }),
    z.strictObject({ kind: z.literal('urlMatches'), pattern: z.string().min(1) }),
    z.strictObject({ kind: z.literal('httpStatus'), codes: z.array(z.number().int().min(100).max(599)).min(1) }),
    z.strictObject({ kind: z.literal('dialogPresent') }),
    z.strictObject({ kind: z.literal('outputResolvable'), outputName: z.string().min(1) }),
    z.strictObject({ kind: z.literal('all'), of: z.array(ConditionMatcher).min(1) }),
    z.strictObject({ kind: z.literal('any'), of: z.array(ConditionMatcher).min(1) }),
    z.strictObject({ kind: z.literal('not'), of: ConditionMatcher }),
  ]),
);
