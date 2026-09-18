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

// Every wait on another process is bounded. An e2e suite that hangs is worse than one that
// fails, because a hang looks like slowness until somebody has lost an afternoon to it, and
// the only run of this suite that ever hung took forty seven minutes to say so.
const START_DEADLINE_MS = 30_000;
const STOP_DEADLINE_MS = 10_000;

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
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`MERIDIAN Core did not say it was listening within ${START_DEADLINE_MS}ms. ${said}`));
    }, START_DEADLINE_MS);
    const done = (settle: () => void): void => {
      clearTimeout(deadline);
      settle();
    };
    const settle = (chunk: string): void => {
      said += chunk;
      if (said.includes('listening on')) done(() => listening(child));
      // The port the allowlist names is the one a person's own npm run target would be on, so
      // the clash is worth naming rather than timing out on.
      if (said.includes('EADDRINUSE') || said.includes('could not listen')) {
        done(() =>
          reject(new Error(`Port ${TARGET_PORT} is in use. Stop npm run target first, because this suite starts its own app on the port the allowlist names.`)),
        );
      }
    };
    child.stdout?.setEncoding('utf8').on('data', settle);
    child.stderr?.setEncoding('utf8').on('data', settle);
    child.once('error', (error) => done(() => reject(error)));
    child.once('exit', (code) => done(() => reject(new Error(`MERIDIAN Core exited with ${code} before it was listening. ${said}`))));
  });
}

export async function stopTarget(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) return;
  await new Promise<void>((stopped) => {
    // A process that ignores the first ask is killed outright. The next file in the suite needs
    // the port, and waiting politely for a process that is never going to answer is the hang.
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      stopped();
    }, STOP_DEADLINE_MS);
    child.once('exit', () => {
      clearTimeout(deadline);
      stopped();
    });
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
