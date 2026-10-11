import { describe, expect, it } from 'vitest';
import {
  directoryOf,
  encodingLabel,
  errorMessage,
  fileName,
  firstHeading,
  formatBytes,
  formatCount,
  isCancelled,
  legacyEncodingLabel,
  lineEndingLabel,
  nextUntitledName,
  suggestSaveName,
} from '@/shell/document';

describe('fileName and directoryOf', () => {
  it('returns the last path segment', () => {
    expect(fileName('/Users/me/Notes/plan.md')).toBe('plan.md');
    expect(fileName('plan.md')).toBe('plan.md');
    expect(fileName('C:\\docs\\plan.md')).toBe('plan.md');
    expect(fileName('/folder/')).toBe('folder');
  });

  it('returns the folder of a path', () => {
    expect(directoryOf('/Users/me/Notes/plan.md')).toBe('/Users/me/Notes');
    expect(directoryOf('/plan.md')).toBe('/');
    expect(directoryOf('plan.md')).toBeNull();
  });
});

describe('nextUntitledName', () => {
  it('starts with "Untitled", then counts up', () => {
    expect(nextUntitledName([])).toBe('Untitled');
    expect(nextUntitledName(['Untitled'])).toBe('Untitled 2');
    expect(nextUntitledName(['Untitled', 'Untitled 2'])).toBe('Untitled 3');
  });

  it('reuses the lowest free number', () => {
    expect(nextUntitledName(['Untitled 2'])).toBe('Untitled');
    expect(nextUntitledName(['Untitled', 'Untitled 3'])).toBe('Untitled 2');
  });

  it('ignores names that are not untitled documents', () => {
    expect(nextUntitledName(['plan.md', 'Markdown Guide'])).toBe('Untitled');
  });
});

describe('firstHeading and suggestSaveName', () => {
  it('uses the first heading of any level', () => {
    expect(firstHeading('Intro text\n\n## Second level\n\n# Later')).toBe('Second level');
    expect(suggestSaveName('# Quarterly Report\n\nbody')).toBe('Quarterly Report.md');
  });

  it('skips frontmatter and code fences', () => {
    const text = '---\ntitle: x\n# not a heading\n---\n\n```bash\n# comment\n```\n\n# Real Title\n';
    expect(firstHeading(text)).toBe('Real Title');
  });

  it('removes inline Markdown and closing hashes', () => {
    expect(suggestSaveName('# The **bold** [link](http://x.y) `code` ##')).toBe(
      'The bold link code.md',
    );
  });

  it('replaces characters that are awkward in file names', () => {
    expect(suggestSaveName('# Quantum Flow: Architecture / API')).toBe(
      'Quantum Flow Architecture API.md',
    );
    expect(suggestSaveName('# ...hidden')).toBe('hidden.md');
  });

  it('falls back to Untitled', () => {
    expect(suggestSaveName('')).toBe('Untitled.md');
    expect(suggestSaveName('no heading here')).toBe('Untitled.md');
    expect(suggestSaveName('# :::')).toBe('Untitled.md');
  });

  it('keeps names to a sensible length', () => {
    const name = suggestSaveName(`# ${'word '.repeat(60)}`);
    expect(name.length).toBeLessThanOrEqual(83);
    expect(name.endsWith('.md')).toBe(true);
  });
});

describe('labels', () => {
  it('names encodings as the status bar shows them', () => {
    expect(encodingLabel('utf-8', null)).toBe('UTF-8');
    expect(encodingLabel('utf-8-bom', null)).toBe('UTF-8 with BOM');
    expect(encodingLabel('utf-16le', null)).toBe('UTF-16 LE');
    expect(encodingLabel('utf-16be', null)).toBe('UTF-16 BE');
    expect(encodingLabel('utf-8', 'windows-1252')).toBe('Windows-1252');
  });

  it('writes legacy encoding names as people do', () => {
    expect(legacyEncodingLabel('windows-1252')).toBe('Windows-1252');
    expect(legacyEncodingLabel('iso-8859-2')).toBe('ISO-8859-2');
    expect(legacyEncodingLabel('shift_jis')).toBe('Shift JIS');
    expect(legacyEncodingLabel('koi8-r')).toBe('KOI8-R');
  });

  it('labels line endings', () => {
    expect(lineEndingLabel('lf')).toBe('LF');
    expect(lineEndingLabel('crlf')).toBe('CRLF');
  });

  it('groups numbers the en-US way', () => {
    expect(formatCount(1420)).toBe('1,420');
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(0)).toBe('0');
  });
});

describe('formatBytes', () => {
  it('uses decimal units like Finder', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(812)).toBe('812 bytes');
    expect(formatBytes(3400)).toBe('3.4 KB');
    expect(formatBytes(12_100)).toBe('12.1 KB');
    expect(formatBytes(4000)).toBe('4 KB');
    expect(formatBytes(124_400)).toBe('124 KB');
    expect(formatBytes(1_230_000)).toBe('1.2 MB');
    expect(formatBytes(5_242_880)).toBe('5.2 MB');
  });
});

describe('errorMessage and isCancelled', () => {
  it('handles strings, Error objects, platform errors and anything else', () => {
    expect(errorMessage('File is larger than 50 MB.')).toBe('File is larger than 50 MB.');
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage({ code: 'io', message: 'The disk is full.' })).toBe('The disk is full.');
    expect(errorMessage({ weird: true })).toBe('Something went wrong.');
  });

  it('recognizes a cancelled dialog', () => {
    expect(isCancelled({ code: 'cancelled', message: 'x' })).toBe(true);
    expect(isCancelled({ code: 'io', message: 'x' })).toBe(false);
    expect(isCancelled('cancelled')).toBe(false);
  });
});
