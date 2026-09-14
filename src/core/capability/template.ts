export type TemplateScope = 'inputs' | 'outputs' | 'env';

export interface TemplateReference {
  readonly scope: TemplateScope;
  readonly name: string;
}

export interface TemplateScan {
  readonly references: readonly TemplateReference[];
  // The inner text of any reference that is not a known scope followed by a name.
  readonly malformed: readonly string[];
}

// {{scope.name}} with optional inner whitespace. A backslash before the opening braces
// escapes them, so \{{ is literal text. Single braces, as in a regex quantifier such
// as [0-9]{5,10}, are never read as a reference.
const REFERENCE = /(\\?)\{\{\s*([^}]*?)\s*\}\}/g;
const SHAPE = /^(inputs|outputs|env)\.([A-Za-z][A-Za-z0-9_]*)$/;

export function scanTemplate(text: string): TemplateScan {
  const references: TemplateReference[] = [];
  const malformed: string[] = [];

  for (const match of text.matchAll(REFERENCE)) {
    if (match[1] === '\\') continue;
    const body = match[2] ?? '';
    const shape = SHAPE.exec(body);
    const scope = shape?.[1];
    const name = shape?.[2];
    if ((scope === 'inputs' || scope === 'outputs' || scope === 'env') && name !== undefined) {
      references.push({ scope, name });
    } else {
      malformed.push(body);
    }
  }

  return { references, malformed };
}
