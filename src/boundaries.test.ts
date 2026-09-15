import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Architectural rules from docs/SAFETY.md section 1, enforced over the source tree rather
// than by convention. Type only imports count, because a module that can name the raw
// driver's types is one edit away from constructing it.

const repository = resolve(import.meta.dirname, '..');
const SPECIFIER = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

function sourceFiles(directory: string): string[] {
  const absolute = join(repository, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((entry) => {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) return sourceFiles(relative(repository, path));
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(SPECIFIER)].flatMap((match) => {
    const specifier = match[1] ?? match[2];
    return specifier === undefined ? [] : [resolve(dirname(file), specifier.replace(/\.js$/, '.ts'))];
  });
}

function reachableFrom(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const pending = [...entries];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    pending.push(...importsOf(file));
  }
  return new Set([...seen].map((file) => relative(repository, file).replaceAll('\\', '/')));
}

describe('module boundaries', () => {
  it('follows imports far enough to find authorize behind GuardedSurface', () => {
    expect(reachableFrom([join(repository, 'src/surface/guardedSurface.ts')])).toContain('src/core/policy/authorize.ts');
  });

  it('keeps replay and discovery away from the raw drivers', () => {
    const reached = [...reachableFrom([...sourceFiles('src/replay'), ...sourceFiles('src/discovery')])];

    expect(reached.filter((file) => file.startsWith('src/surface/web/') || file.startsWith('src/surface/fake/'))).toEqual([]);
  });

  it('keeps every model client and the Anthropic SDK out of replay', () => {
    const reached = [...reachableFrom(sourceFiles('src/replay'))];

    expect(reached).toContain('src/replay/executor.ts');
    expect(reached.filter((file) => file.startsWith('src/discovery/'))).toEqual([]);
    expect(reached.filter((file) => /from\s+['"]@anthropic-ai\/sdk['"]/.test(readFileSync(join(repository, file), 'utf8')))).toEqual([]);
  });

  it('calls authorize from exactly one place, inside GuardedSurface', () => {
    const callers = sourceFiles('src')
      .filter((file) => /(?<!function\s)\bauthorize\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repository, file).replaceAll('\\', '/'));

    expect(callers).toEqual(['src/surface/guardedSurface.ts']);
  });
});
