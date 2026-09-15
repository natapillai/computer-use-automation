// Path globs for the allowlist and the app profile. * matches within one segment. **
// matches across segments, and a /** segment also matches nothing, so /servicing/**
// covers /servicing itself.
export function globToRegExp(glob: string): RegExp {
  let source = '';
  let i = 0;
  while (i < glob.length) {
    if (glob.startsWith('/**', i)) {
      source += '(?:/.*)?';
      i += 3;
    } else if (glob.startsWith('**', i)) {
      source += '.*';
      i += 2;
    } else if (glob.charAt(i) === '*') {
      source += '[^/]*';
      i += 1;
    } else {
      source += glob.charAt(i).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}
