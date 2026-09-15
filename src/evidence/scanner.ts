import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { z } from 'zod';
import { scanText, type ScanHit, type ScanRules } from '../core/redaction/scan.js';

// Walks the committed directories that hold anything produced by running code or a model.
// A permanent test runs it over the real tree, see docs/EVIDENCE.md section 5.

export interface EvidenceScan {
  readonly filesScanned: number;
  readonly directoriesFound: readonly string[];
  readonly hits: readonly ScanHit[];
}

export const GUARDED_DIRECTORIES = ['evidence', 'capabilities', 'tests/fixtures/cassettes'] as const;

// Screenshots are masked before the bytes exist, which the pixel test proves. Their bytes
// are not text and are not scanned.
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export async function scanDirectories(root: string, directories: readonly string[], rules: ScanRules): Promise<EvidenceScan> {
  const directoriesFound: string[] = [];
  const hits: ScanHit[] = [];
  let filesScanned = 0;

  for (const directory of directories) {
    const files = await filesUnder(join(root, directory));
    if (files === null) continue;
    directoriesFound.push(directory);
    for (const file of files.sort()) {
      if (IMAGES.has(extname(file).toLowerCase())) continue;
      filesScanned += 1;
      hits.push(...scanText(relative(root, file).split('\\').join('/'), await readFile(file, 'utf8'), rules));
    }
  }
  return { filesScanned, directoriesFound, hits };
}

// Null only when the directory does not exist. Any other failure to read it throws, so a
// scan that could not look never reports that it found nothing.
async function filesUnder(directory: string): Promise<string[] | null> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT') return null;
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...((await filesUnder(path)) ?? []));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const Seed = z.object({
  members: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), card: z.string().optional(), accounts: z.array(z.object({ balance: z.string().min(1) })) }))
    .min(1),
});

// The seed's distinctive strings, per docs/TARGET_APP.md section 6. A card number is listed
// with and without its spaces.
export async function canariesFromSeed(path: string): Promise<readonly string[]> {
  const seed = Seed.parse(JSON.parse(await readFile(path, 'utf8')));
  const canaries = new Set<string>();
  for (const member of seed.members) {
    canaries.add(member.id);
    canaries.add(member.name);
    if (member.card !== undefined) {
      canaries.add(member.card);
      canaries.add(member.card.replace(/\s/g, ''));
    }
    for (const account of member.accounts) canaries.add(account.balance);
  }
  return [...canaries];
}
