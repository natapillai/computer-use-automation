import { z } from 'zod';

// The executable form of policy/allowlist.yaml, see docs/SAFETY.md section 2. Core
// validates an already parsed object. Reading the YAML file happens outside core.

const Origin = z.strictObject({
  pattern: z.string().regex(/^https?:\/\/[^/]+$/, 'must be a scheme, host and port with no path'),
  description: z.string().min(1),
  allowedPaths: z.array(z.string().startsWith('/')).min(1),
  deniedPaths: z.array(z.string().startsWith('/')).default([]),
});

// flags is an explicit field. An inline (?i) is PCRE syntax that JavaScript rejects.
// A pattern that does not compile is refused at load, not at the first redaction.
// Otherwise the redactor would meet it mid run, where the only safe choice left is to
// drop the whole value.
const RedactPattern = z
  .strictObject({
    name: z.string().min(1),
    pattern: z.string().min(1),
    flags: z.string().regex(/^[gimsuy]*$/).default('g'),
    validator: z.enum(['luhn']).optional(),
    contextual: z.boolean().optional(),
  })
  .superRefine((redactPattern, ctx) => {
    try {
      new RegExp(redactPattern.pattern, redactPattern.flags);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['pattern'],
        message: `Redaction pattern "${redactPattern.name}" does not compile. Put flags in the flags field.`,
      });
    }
  });

export const Allowlist = z.strictObject({
  version: z.literal(1),
  origins: z.array(Origin).min(1),
  actions: z.strictObject({
    allowed: z.array(z.string().min(1)).min(1),
    denied: z.array(z.string().min(1)).default([]),
  }),
  risk: z.strictObject({
    unclassified: z.literal('deny'),
    writeHandling: z.literal('confirm'),
    sensitiveHandling: z.literal('allow_redacted'),
  }),
  budgets: z.strictObject({
    maxStepsPerRun: z.number().int().positive(),
    maxModelCallsPerRun: z.number().int().positive(),
    maxRunDurationMs: z.number().int().positive(),
  }),
  data: z.strictObject({
    neverPersist: z.array(z.string().min(1)),
    redactPatterns: z.array(RedactPattern),
  }),
});

export type Allowlist = z.output<typeof Allowlist>;
