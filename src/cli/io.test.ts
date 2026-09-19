import { describe, expect, it } from 'vitest';
import { parseInputObject } from './io.js';

// Inputs arrive on stdin or in a file, and both routes carry whatever the shell or the editor
// put in front of the text. PowerShell prepends a byte order mark to anything it pipes into a
// native command, and Windows editors write one into a saved file, so a caller on Windows who
// does exactly what the README says gets a parse failure that names their inputs as malformed.

describe('parseInputObject', () => {
  it('reads one object keyed by input name', () => {
    expect(parseInputObject('{"memberId":"10001"}')).toEqual({ memberId: '10001' });
  });

  it('reads an object a Windows shell or editor put a byte order mark in front of', () => {
    expect(parseInputObject('﻿{"memberId":"10001"}')).toEqual({ memberId: '10001' });
    expect(parseInputObject('﻿  {"memberId":"10001"}\r\n')).toEqual({ memberId: '10001' });
  });

  it('refuses anything that is not one object, without repeating what it was given', () => {
    expect(parseInputObject('[1,2]')).toBeNull();
    expect(parseInputObject('"10001"')).toBeNull();
    expect(parseInputObject('not json')).toBeNull();
    expect(parseInputObject('')).toBeNull();
  });
});
