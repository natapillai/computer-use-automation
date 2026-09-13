import { describe, expect, it } from 'vitest';
import { findUndefinedTaskReferences } from './taskReferences.js';

const plan = ['* [ ] **S0-T01** Repo skeleton.', '* [x] **S0-T02** Clock and IdProvider.'].join('\n');

describe('findUndefinedTaskReferences', () => {
  it('reports a reference to a task ID the plan does not define', () => {
    const documents = [{ path: 'docs/EXAMPLE.md', text: 'Owned by S0-T01.\nLands at S9-T99.' }];

    expect(findUndefinedTaskReferences(documents, plan)).toEqual([
      { path: 'docs/EXAMPLE.md', line: 2, id: 'S9-T99' },
    ]);
  });

  it('treats a ticked task as defined', () => {
    const documents = [{ path: 'docs/EXAMPLE.md', text: 'Finished at S0-T02.' }];

    expect(findUndefinedTaskReferences(documents, plan)).toEqual([]);
  });

  it('exempts only the ID directly marked retired', () => {
    const documents = [{ path: 'docs/EXAMPLE.md', text: 'Cited retired S0-T08, then S9-T99.' }];

    expect(findUndefinedTaskReferences(documents, plan)).toEqual([
      { path: 'docs/EXAMPLE.md', line: 1, id: 'S9-T99' },
    ]);
  });
});
