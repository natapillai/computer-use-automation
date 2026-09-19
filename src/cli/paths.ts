// Where a run put its evidence, said in a way that can be pasted into a ticket. A command
// prints for a person and a person forwards what it printed, so an absolute path is a small
// leak of the machine that produced it and of whoever was logged into it. The first live run
// put one in the log. Fixing it there and not in stdout is how the second live run found it
// again, which is why this is a function with a test rather than a rule I remember.

const MACHINE = [
  // Windows home directories and any drive rooted path.
  /^[A-Za-z]:[\\/]/,
  // Unix home directories and the usual temporary roots.
  /^\/(home|Users|var|tmp|private)\//,
  /^~[\\/]/,
];

export function looksLikeMachinePath(text: string): boolean {
  return MACHINE.some((shape) => shape.test(text));
}

// The last segment of the root, then the phase and the run. Keeping the root's own name means
// a caller who asked for a different evidence directory still recognises the answer, and
// dropping everything above it means the answer says nothing about the machine.
export function asReference(root: string, phase: string, runId: string): string {
  const segments = root.split(/[\\/]/).filter((segment) => segment !== '' && segment !== '.');
  const name = segments.at(-1) ?? 'evidence';
  return `${name}/${phase}/${runId}`;
}
