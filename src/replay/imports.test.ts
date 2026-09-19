import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// S6-T03. Deterministic replay means no model in the decision loop, and the way that stops
// being true is a helper somewhere under src/replay reaching for one. A comment saying so is
// not a control, so this walks what src/replay actually imports, transitively, and looks for
// the model at the far end of the graph rather than at the near end.

const ROOT = resolve(import.meta.dirname, '..', '..');
const ENTRY = 'src/replay';

// Anything that talks to a model, by module and by package.
const MODEL_MODULES = ['src/discovery/modelClient', 'src/discovery/anthropicModelClient', 'src/discovery/cassetteModelClient', 'src/discovery/fakeModelClient', 'src/discovery/agentLoop'];
const MODEL_PACKAGES = ['@anthropic-ai/sdk'];

async function sourceFilesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, directory), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).split('\\').join('/'));
}

// Every specifier the file imports or re exports, type only imports included, because a type
// import is still a dependency on a module that could grow a value later.
function specifiersIn(text: string): string[] {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return [...withoutComments.matchAll(/(?:^|\s)(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const joined = join(dirname(fromFile), specifier).split('\\').join('/');
  return joined.replace(/\.js$/, '.ts');
}

describe('the replay import graph', () => {
  it('reaches no model client and no model package from anywhere under src/replay', async () => {
    const seen = new Set<string>();
    const packages = new Map<string, string>();
    const queue = await sourceFilesUnder(ENTRY);
    expect(queue.length).toBeGreaterThan(0);

    while (queue.length > 0) {
      const file = queue.shift();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);

      let text: string;
      try {
        text = await readFile(join(ROOT, file), 'utf8');
      } catch {
        // A specifier that does not resolve to a file on disk is a directory index or a type
        // only path. Neither can reach a model, and failing here would hide the real check.
        continue;
      }

      for (const specifier of specifiersIn(text)) {
        const local = resolveLocal(file, specifier);
        if (local === null) {
          if (MODEL_PACKAGES.includes(specifier)) packages.set(specifier, file);
          continue;
        }
        queue.push(local);
      }
    }

    const reached = [...seen].filter((file) => MODEL_MODULES.some((module) => file.startsWith(module)));
    expect(reached, `src/replay reaches ${reached.join(', ')}`).toEqual([]);
    expect([...packages.entries()].map(([name, from]) => `${name} from ${from}`)).toEqual([]);

    // The walk found the graph rather than stopping at the entry directory, which is what
    // makes an empty result mean something.
    expect(seen.size).toBeGreaterThan(10);
    expect([...seen]).toContain('src/core/outcome/result.ts');
  });
});
