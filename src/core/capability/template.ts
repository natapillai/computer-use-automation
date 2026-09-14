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
// as [0-9]{5,10}, are never read as a reference. Group 1 is the escape, group 2 the body.
const REFERENCE_SOURCE = String.raw`(\\?)\{\{\s*([^}]*?)\s*\}\}`;
const SHAPE = /^(inputs|outputs|env)\.([A-Za-z][A-Za-z0-9_]*)$/;

// A fresh global expression per call, so no caller shares lastIndex state.
export function templateReferencePattern(): RegExp {
  return new RegExp(REFERENCE_SOURCE, 'g');
}

// Scanning and resolving both read a reference through this, so they cannot disagree
// about what counts as one.
export function parseReferenceBody(body: string): TemplateReference | null {
  const shape = SHAPE.exec(body);
  const scope = shape?.[1];
  const name = shape?.[2];
  if ((scope === 'inputs' || scope === 'outputs' || scope === 'env') && name !== undefined) {
    return { scope, name };
  }
  return null;
}

export function scanTemplate(text: string): TemplateScan {
  const references: TemplateReference[] = [];
  const malformed: string[] = [];

  for (const match of text.matchAll(templateReferencePattern())) {
    if (match[1] === '\\') continue;
    const body = match[2] ?? '';
    const reference = parseReferenceBody(body);
    if (reference === null) {
      malformed.push(body);
    } else {
      references.push(reference);
    }
  }

  return { references, malformed };
}
