import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findUndefinedTaskReferences } from './taskReferences.js';

// Every markdown file git would commit, tracked or new, and nothing it ignores. That
// excludes node_modules and the gitignored brief without a hand maintained list.
function committableMarkdown(): string[] {
  const listing = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], {
    encoding: 'utf8',
  });
  return listing.split('\n').filter((path) => path.length > 0);
}

describe('task references across the committed documents', () => {
  it('references only task IDs that docs/PLAN.md defines', () => {
    const documents = committableMarkdown().map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    const plan = readFileSync('docs/PLAN.md', 'utf8');

    expect(findUndefinedTaskReferences(documents, plan)).toEqual([]);
  });
});
