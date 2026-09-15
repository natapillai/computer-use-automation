import { z } from 'zod';

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvError {
  readonly kind: 'EnvInvalid';
  readonly message: string;
  readonly variables: readonly string[];
}

export type EnvResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EnvError };

export interface TargetEnv {
  readonly targetBaseUrl: string;
  readonly targetUsername: string;
  readonly targetPassword: string;
  readonly interventionClaimTimeoutMs: number;
}

export interface ModelEnv {
  readonly model: string;
}

// Credentials have no default, so a missing one fails here rather than at login.
const TargetEnvSchema = z.object({
  TARGET_BASE_URL: z.url().default('http://localhost:4010'),
  TARGET_USERNAME: z.string().min(1),
  TARGET_PASSWORD: z.string().min(1),
  INTERVENTION_CLAIM_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
});

// The model id is configuration and has no default in code, per ADR 0011.
// ANTHROPIC_API_KEY is deliberately absent. The SDK reads it directly, so the key
// never sits in a config object that could be logged.
const ModelEnvSchema = z.object({
  ANTHROPIC_MODEL: z.string().min(1),
});

export function parseTargetEnv(source: EnvSource): EnvResult<TargetEnv> {
  return parseWith(TargetEnvSchema, source, (env) => ({
    targetBaseUrl: env.TARGET_BASE_URL,
    targetUsername: env.TARGET_USERNAME,
    targetPassword: env.TARGET_PASSWORD,
    interventionClaimTimeoutMs: env.INTERVENTION_CLAIM_TIMEOUT_MS,
  }));
}

export function parseModelEnv(source: EnvSource): EnvResult<ModelEnv> {
  return parseWith(ModelEnvSchema, source, (env) => ({ model: env.ANTHROPIC_MODEL }));
}

function parseWith<S extends z.ZodType, T>(
  schema: S,
  source: EnvSource,
  toConfig: (env: z.output<S>) => T,
): EnvResult<T> {
  const parsed = schema.safeParse(source);
  if (parsed.success) {
    return { ok: true, value: toConfig(parsed.data) };
  }

  const variables: string[] = [];
  const sentences: string[] = [];
  for (const issue of parsed.error.issues) {
    const name = String(issue.path[0]);
    if (variables.includes(name)) continue;
    variables.push(name);
    // Never echo the value, because the variable may be a credential.
    sentences.push(source[name] === undefined ? `${name} is required.` : `${name} is invalid. ${issue.message}.`);
  }

  return {
    ok: false,
    error: { kind: 'EnvInvalid', message: ['Invalid environment.', ...sentences].join(' '), variables },
  };
}

// Presence only, so a live discovery run cannot start by accident. The SDK reads the key
// itself, and this check never keeps or reports more than whether it is set.
export function checkLiveModelKey(source: EnvSource): EnvResult<{ readonly present: true }> {
  const key = source['ANTHROPIC_API_KEY'];
  if (key === undefined || key === '') {
    return {
      ok: false,
      error: { kind: 'EnvInvalid', message: 'Invalid environment. ANTHROPIC_API_KEY is required for a live discovery run.', variables: ['ANTHROPIC_API_KEY'] },
    };
  }
  return { ok: true, value: { present: true } };
}
