// Arguments name files, never data. Inputs arrive on stdin or in a file, because argv lands in
// shell history and in every process listing on the machine. A refusal names the accepted
// flags and a position, and never repeats what was typed, since what was typed may be a
// member id.

export type ParsedFlags =
  | { readonly ok: true; readonly values: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly message: string };

export function parseFlags(argv: readonly string[], accepted: readonly string[]): ParsedFlags {
  const usage = `This command accepts ${accepted.map((flag) => `--${flag}`).join(', ')}, each followed by a value. Inputs are never passed as arguments.`;
  const values: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index] ?? '';
    const name = token.startsWith('--') ? token.slice(2) : null;
    if (name === null || !accepted.includes(name)) return { ok: false, message: `Argument ${index + 1} is not a flag this command accepts. ${usage}` };
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) return { ok: false, message: `--${name} needs a value. ${usage}` };
    if (Object.hasOwn(values, name)) return { ok: false, message: `--${name} was given more than once. ${usage}` };
    values[name] = value;
  }

  return { ok: true, values };
}
