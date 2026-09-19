// Input plumbing shared by the CLIs. Inputs are data, so they arrive on stdin or in a file and
// never as arguments, see args.ts.

// Null when stdin is a terminal, so a command refuses rather than waiting for someone to type.
export function readPipedStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((done, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
    });
    process.stdin.on('end', () => done(text));
    process.stdin.on('error', reject);
  });
}

// One JSON object keyed by input name, or null. The text is never repeated in a message.
//
// A leading byte order mark is stripped first. PowerShell writes one in front of anything it
// pipes into a native command, and Windows editors write one into a saved file, so both routes
// a caller is told to use can deliver it. Refusing there would report a correct payload as
// malformed, which is a worse answer than the one character it costs to ignore.
export function parseInputObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : null;
}
