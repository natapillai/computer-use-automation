import { z } from 'zod';

export const Confidence = z.number().min(0).max(1);

// Relations between nodes, computed from bounding boxes rather than markup or table
// roles. See ADR 0012.
export const Relation = z.enum(['sameRow', 'rightOf', 'below', 'firstBelow']);

const RoleNameStrategy = z.strictObject({
  kind: z.literal('role-name'),
  role: z.string().min(1),
  name: z.string(),
  exact: z.boolean(),
  confidence: Confidence,
});

const LabelStrategy = z.strictObject({ kind: z.literal('label'), text: z.string().min(1), confidence: Confidence });

const TextStrategy = z.strictObject({
  kind: z.literal('text'),
  text: z.string().min(1),
  exact: z.boolean(),
  confidence: Confidence,
});

const TestIdStrategy = z.strictObject({
  kind: z.literal('test-id'),
  attr: z.string().min(1),
  value: z.string().min(1),
  confidence: Confidence,
});

const StructuralStrategy = z.strictObject({ kind: z.literal('structural'), path: z.string().min(1), confidence: Confidence });

// An anchor is a stable landmark, a heading or a piece of text, and never itself
// relative. That keeps a bundle flat enough to review and resolution non recursive.
export const AnchorStrategy = z.discriminatedUnion('kind', [RoleNameStrategy, LabelStrategy, TextStrategy]);

const AnchorRelativeStrategy = z.strictObject({
  kind: z.literal('anchor-relative'),
  anchor: AnchorStrategy,
  relation: Relation,
  role: z.string().min(1).optional(),
  confidence: Confidence,
});

// No visual strategy. Nothing in this system would ever execute one, see ADR 0013.
export const LocatorStrategy = z.discriminatedUnion('kind', [
  RoleNameStrategy,
  TestIdStrategy,
  LabelStrategy,
  TextStrategy,
  AnchorRelativeStrategy,
  StructuralStrategy,
]);

// No first match policy. Silently taking the first of several matches is how
// automation clicks the wrong account.
export const LocatorBundle = z
  .strictObject({
    framePath: z.array(z.string()),
    strategies: z.array(LocatorStrategy).min(1),
    matchPolicy: z.enum(['unique', 'nth']),
    nth: z.number().int().nonnegative().optional(),
    describedAs: z.string().min(1),
  })
  .refine((bundle) => (bundle.matchPolicy === 'nth') === (bundle.nth !== undefined), {
    error: 'nth is required exactly when matchPolicy is nth',
    path: ['nth'],
  });

export type LocatorStrategy = z.infer<typeof LocatorStrategy>;
export type AnchorStrategy = z.infer<typeof AnchorStrategy>;
export type LocatorBundle = z.infer<typeof LocatorBundle>;
export type Relation = z.infer<typeof Relation>;
