import { scanTemplate } from '../core/capability/template.js';

// The standing instructions for discovery. Wording may change without a re record, because a
// cassette asserts the tools and the observation, never the prompt, per ADR 0017.
const STANDING = [
  'You operate a legacy back office banking application through its accessibility tree.',
  'Each observation lists the elements you can use, one per line, as [ref] role "name", grouped by the frame they are in.',
  'Act only through the tools, with one tool call per turn, using refs from the latest observation. A ref from an older observation may now point at a different element.',
  'Member data on screen is hidden as [redacted:...]. You do not need it to navigate.',
  'You never see input values. You type an input by naming it in fill, and a field that holds an input shows value="{{inputs.name}}".',
  'When you reach the value the goal asks for, call extract on the element that shows it, then call done. If you cannot make progress, call escalate and say why.',
];

// What a run that may change state is told on top. Only such a run is offered the flag, so a
// read only run is never told about a parameter it does not have.
const WRITING = [
  'This goal changes a record, so click and press take a submits flag.',
  'Set submits true on the one action that commits the change, such as the button that opens the account or saves the form. Leave it off everywhere else, including navigation and filling fields.',
  'A declared action stops and waits for a person to approve it. You will be told what they decided and the run carries on from there.',
  'An action that changes a record without the flag is refused before it reaches the application, so leaving it off does not make the change happen quietly.',
];

export interface PromptOptions {
  readonly writes?: boolean;
}

export function systemPrompt(options: PromptOptions = {}): string {
  return [...STANDING, ...(options.writes === true ? WRITING : [])].join('\n');
}

export const SYSTEM_PROMPT = systemPrompt();

export type GoalText =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: 'GoalCarriesInput'; readonly inputs: readonly string[] }
  | { readonly ok: false; readonly failure: 'GoalReferencesUnknownInput'; readonly references: readonly string[] };

// The goal reaches the model with every input as a template, never as a value, see
// docs/SAFETY.md section 4. A goal that carries a supplied value is refused rather than
// silently rewritten, so the person who wrote it learns why.
export function buildGoal(goal: string, inputs: Readonly<Record<string, string>>): GoalText {
  const names = Object.keys(inputs);

  const unknown = scanTemplate(goal)
    .references.filter((reference) => reference.scope === 'inputs' && !names.includes(reference.name))
    .map((reference) => reference.name);
  if (unknown.length > 0) return { ok: false, failure: 'GoalReferencesUnknownInput', references: unknown };

  const carried = names.filter((name) => {
    const value = inputs[name] ?? '';
    return value !== '' && new RegExp(`(?<!\\w)${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`).test(goal);
  });
  if (carried.length > 0) return { ok: false, failure: 'GoalCarriesInput', inputs: carried };

  return { ok: true, text: `Goal: ${goal}\nInputs you can type: ${names.join(', ')}.` };
}
