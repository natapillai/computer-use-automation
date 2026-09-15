import type { UINode } from '../surfaceModel/types.js';
import type { Redactor } from './redactor.js';

// A tree as a trace or an evidence snapshot may keep it. Cells the app profile marks sensitive
// are hidden, a supplied value shows as its template, and every other piece of text passes
// through the redactor. Refs, roles, boxes and frame paths are kept, so a locator bundle can be
// derived again from what was stored.

export interface TreeMaskContext {
  // Refs the app profile marks sensitive in the observation the tree came from.
  readonly sensitive: ReadonlyMap<string, unknown>;
  readonly inputs: Readonly<Record<string, string>>;
  readonly redactor: Redactor;
}

export function maskTree(node: UINode, context: TreeMaskContext): UINode {
  const known = Object.entries(context.inputs)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => ({ value, replacement: `{{inputs.${name}}}` }));
  const clean = (text: string): string => context.redactor.text(text, { known });
  const templateOnly = (text: string): string | null => {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    const input = Object.entries(context.inputs).find(([, value]) => value !== '' && value === collapsed);
    return input === undefined ? null : `{{inputs.${input[0]}}}`;
  };

  const walk = (current: UINode, hidden: boolean): UINode => {
    const hide = hidden || context.sensitive.has(current.ref);
    const name = hide && current.name.trim() !== '' ? (templateOnly(current.name) ?? '[redacted:pii]') : clean(current.name);
    return {
      ...current,
      name,
      ...(current.value === undefined ? {} : { value: hide ? (templateOnly(current.value) ?? '[redacted:pii]') : clean(current.value) }),
      ...(current.derivedLabel === undefined ? {} : { derivedLabel: clean(current.derivedLabel) }),
      children: current.children.map((child) => walk(child, hide)),
    };
  };

  return walk(node, false);
}
