import { deriveBundle, type DroppedStrategy } from '../core/locator/derive.js';
import type { LocatorBundle } from '../core/locator/schema.js';
import { sensitiveFields, type AppProfile } from '../core/policy/profile.js';
import { maskTree } from '../core/redaction/maskTree.js';
import type { Redactor } from '../core/redaction/redactor.js';
import { findNodeByRef } from '../core/surfaceModel/tree.js';
import type { Observation, UINode } from '../core/surfaceModel/types.js';

// Records each action discovery takes, with a locator bundle derived from the real element at
// the moment of acting. The loop passes a ref and names, never text the model wrote about an
// element, so nothing the model says can become a selector. See ADR 0013.

export type RecordedTool = 'click' | 'fill' | 'select' | 'press' | 'navigate' | 'extract';

export interface ActionToRecord {
  readonly tool: RecordedTool;
  readonly observation: Observation;
  readonly ref?: string;
  readonly inputName?: string;
  readonly key?: string;
  readonly path?: string;
  readonly framePath?: readonly string[];
  readonly output?: string;
}

export interface RecordedAction {
  readonly index: number;
  readonly tool: RecordedTool;
  readonly framePath: readonly string[];
  readonly bundle: LocatorBundle | null;
  readonly dropped: readonly DroppedStrategy[];
  readonly value?: string;
  readonly key?: string;
  readonly path?: string;
  readonly output?: string;
  // Set once the action ran. changed says whether the page's progress key moved.
  readonly ok?: boolean;
  readonly changed?: boolean;
  // The acted element's parent with member data masked, so a bundle can be derived again later.
  readonly neighbourhood?: UINode;
}

export interface Recorder {
  record(action: ActionToRecord): RecordedAction;
  complete(index: number, outcome: { readonly ok: boolean; readonly changed: boolean }): void;
  actions(): readonly RecordedAction[];
}

export interface RecorderContext {
  readonly profile: AppProfile;
  readonly redactor: Redactor;
  readonly inputs: Readonly<Record<string, string>>;
}

export function createRecorder(context: RecorderContext): Recorder {
  const recorded: RecordedAction[] = [];

  return {
    record: (action) => {
      const index = recorded.length;
      let entry: RecordedAction;

      if (action.tool === 'navigate' || action.ref === undefined) {
        entry = {
          index,
          tool: action.tool,
          framePath: [...(action.framePath ?? [])],
          bundle: null,
          dropped: [],
          ...(action.path === undefined ? {} : { path: action.path }),
        };
      } else {
        const node = findNodeByRef(action.observation.root, action.ref);
        const sensitive = sensitiveFields(context.profile, action.observation);
        const derived = deriveBundle(action.observation, action.ref, {
          inputs: context.inputs,
          sensitive,
          redacts: (text) => context.redactor.text(text, { known: [] }) !== text,
        });
        const parent = parentOf(action.observation.root, action.ref);
        entry = {
          index,
          tool: action.tool,
          framePath: [...(node?.framePath ?? [])],
          bundle: derived.ok ? derived.bundle : null,
          dropped: derived.dropped,
          // The template, never the value that was typed.
          ...(action.inputName === undefined ? {} : { value: `{{inputs.${action.inputName}}}` }),
          ...(action.key === undefined ? {} : { key: action.key }),
          ...(action.output === undefined ? {} : { output: action.output }),
          ...(parent === null ? {} : { neighbourhood: maskTree(parent, { sensitive, inputs: context.inputs, redactor: context.redactor }) }),
        };
      }

      recorded.push(entry);
      return entry;
    },
    complete: (index, outcome) => {
      const entry = recorded[index];
      if (entry === undefined) throw new TypeError(`There is no recorded action ${index} to complete.`);
      recorded[index] = { ...entry, ok: outcome.ok, changed: outcome.changed };
    },
    actions: () => [...recorded],
  };
}

function parentOf(root: UINode, ref: string): UINode | null {
  for (const child of root.children) {
    if (child.ref === ref) return root;
    const found = parentOf(child, ref);
    if (found !== null) return found;
  }
  return null;
}
