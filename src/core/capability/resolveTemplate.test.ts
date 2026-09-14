import { describe, expect, it } from 'vitest';
import { resolveTemplate, type TemplateValues } from './resolveTemplate.js';

const values: TemplateValues = {
  inputs: { memberId: '10001' },
  outputs: { savingsBalance: '$4,250.75' },
  env: { TENANT_LABEL: 'Test Credit Union', SECRET_TOKEN: 'never-inline-me' },
};
const allowedEnv = ['TENANT_LABEL'];

describe('resolveTemplate', () => {
  it('resolves inputs, outputs and allowlisted env', () => {
    const result = resolveTemplate(
      'Member {{inputs.memberId}} of {{ env.TENANT_LABEL }} holds {{outputs.savingsBalance}}',
      values,
      allowedEnv,
    );

    expect(result).toEqual({ ok: true, text: 'Member 10001 of Test Credit Union holds $4,250.75' });
  });

  it('fails on a reference with no value, so nothing acts on a half resolved string', () => {
    expect(resolveTemplate('{{inputs.memberId}} {{inputs.surname}}', values, allowedEnv)).toEqual({
      ok: false,
      failure: 'UnresolvedReference',
      references: ['inputs.surname'],
    });
  });

  it('treats an env key outside the allowlist as unresolved even when the environment has it', () => {
    expect(resolveTemplate('{{env.SECRET_TOKEN}}', values, allowedEnv)).toEqual({
      ok: false,
      failure: 'UnresolvedReference',
      references: ['env.SECRET_TOKEN'],
    });
  });

  it('passes text with no template through unchanged, including a regex quantifier', () => {
    expect(resolveTemplate('^[0-9]{5,10}$', values, allowedEnv)).toEqual({ ok: true, text: '^[0-9]{5,10}$' });
  });

  it('keeps an escaped reference as literal braces', () => {
    expect(resolveTemplate('\\{{inputs.memberId}}', values, allowedEnv)).toEqual({ ok: true, text: '{{inputs.memberId}}' });
  });

  it('reports a malformed reference as unresolved', () => {
    expect(resolveTemplate('{{memberId}}', values, allowedEnv)).toEqual({
      ok: false,
      failure: 'UnresolvedReference',
      references: ['memberId'],
    });
  });
});
