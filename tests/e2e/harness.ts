import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

// What every e2e file shares. MERIDIAN Core runs on the port the committed allowlist names, so
// a CLI runs under the real policy unchanged, and each CLI runs as its own process.
//
// The app is started the way the README tells a person to start it, as its own process running
// apps/target/src/server.ts. Creating it in process was a shortcut that left the one command
// every demo begins with covered by nothing.

export const REPOSITORY = resolve(import.meta.dirname, '../..');
export const TARGET_PORT = 4010;

export interface CliRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function startTarget(idSeed: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/target/src/server.ts'], {
    cwd: REPOSITORY,
    env: {
      ...process.env,
      TARGET_BASE_URL: `http://localhost:${TARGET_PORT}`,
      TARGET_USERNAME: 'operator',
      TARGET_PASSWORD: 'meridian-fixture',
      TARGET_ID_SEED: idSeed,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise<ChildProcess>((listening, reject) => {
    let said = '';
    const settle = (chunk: string): void => {
      said += chunk;
      if (said.includes('listening on')) listening(child);
      // The port the allowlist names is the one a person's own npm run target would be on, so
      // the clash is worth naming rather than timing out on.
      if (said.includes('EADDRINUSE') || said.includes('could not listen')) {
        reject(new Error(`Port ${TARGET_PORT} is in use. Stop npm run target first, because this suite starts its own app on the port the allowlist names.`));
      }
    };
    child.stdout?.setEncoding('utf8').on('data', settle);
    child.stderr?.setEncoding('utf8').on('data', settle);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`MERIDIAN Core exited with ${code} before it was listening. ${said}`)));
  });
}

export async function stopTarget(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) return;
  await new Promise<void>((stopped) => {
    child.once('exit', () => stopped());
    child.kill();
  });
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
