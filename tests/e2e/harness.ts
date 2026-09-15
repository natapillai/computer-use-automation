import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { createTargetApp } from '../../apps/target/src/app.js';

// What every e2e file shares. MERIDIAN Core runs on the port the committed allowlist names, so
// a CLI runs under the real policy unchanged, and each CLI runs as its own process.

export const REPOSITORY = resolve(import.meta.dirname, '../..');
export const TARGET_PORT = 4010;

export interface CliRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function startTarget(idSeed: string): Promise<Server> {
  const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed });
  return new Promise<Server>((listening, reject) => {
    const bound = app.listen(TARGET_PORT, '127.0.0.1');
    bound.once('listening', () => listening(bound));
    bound.once('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'EADDRINUSE' ? new Error(`Port ${TARGET_PORT} is in use. Stop npm run target first, because this suite starts its own app on the port the allowlist names.`) : error),
    );
  });
}

export async function stopTarget(server: Server | undefined): Promise<void> {
  if (server !== undefined) await new Promise<void>((closed) => server.close(() => closed()));
}

// The child gets no model variables, so nothing an e2e test starts can reach the API.
export function runCli(bin: string, args: readonly string[], stdin: string): Promise<CliRun> {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('ANTHROPIC_')));
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', bin, ...args], {
      cwd: REPOSITORY,
      env: { ...inherited, TARGET_BASE_URL: `http://localhost:${TARGET_PORT}`, TARGET_USERNAME: 'operator', TARGET_PASSWORD: 'meridian-fixture' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => done({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}
