import { parseReferenceBody, templateReferencePattern, type TemplateReference } from './template.js';

export interface TemplateValues {
  readonly inputs: Readonly<Record<string, string>>;
  readonly outputs: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
}

export type TemplateResolution =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: 'UnresolvedReference'; readonly references: readonly string[] };

// Pure substitution with no expression language. Every reference must resolve or the
// whole template fails, so nothing downstream ever acts on a half resolved string.
// An env key is only readable if it is on the allowlist, whatever the environment holds.
export function resolveTemplate(text: string, values: TemplateValues, allowedEnv: readonly string[]): TemplateResolution {
  const unresolved: string[] = [];

  const resolved = text.replace(templateReferencePattern(), (whole: string, escape: string, body: string) => {
    if (escape === '\\') return whole.slice(1);
    const reference = parseReferenceBody(body);
    const value = reference === null ? undefined : lookup(reference, values, allowedEnv);
    if (value === undefined) {
      unresolved.push(body);
      return whole;
    }
    return value;
  });

  return unresolved.length > 0
    ? { ok: false, failure: 'UnresolvedReference', references: unresolved }
    : { ok: true, text: resolved };
}

function lookup(reference: TemplateReference, values: TemplateValues, allowedEnv: readonly string[]): string | undefined {
  switch (reference.scope) {
    case 'inputs':
      return own(values.inputs, reference.name);
    case 'outputs':
      return own(values.outputs, reference.name);
    case 'env':
      return allowedEnv.includes(reference.name) ? own(values.env, reference.name) : undefined;
  }
}

function own(record: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
