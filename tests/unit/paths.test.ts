import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directoryOf as exportFolderOf } from '@/export/html';
import { fileUrlOf } from '@/export/images';
import { setOsForTesting } from '@/lib/os';
import { fileUrl, isAbsolutePath, joinPath, parentFolder, pathRoot, samePath } from '@/lib/paths';
import { classifyHref } from '@/preview/events';
import { classifyImageSource } from '@/preview/images';
import { resolveIncludeKey } from '@/preview/rules/quarto/state';
import { directoryOf } from '@/shell/document';
import { ancestorsBelow, isUnder, nameProblem, parentPath } from '@/shell/files/tree';

afterEach(() => setOsForTesting(null));

describe('paths on macOS', () => {
  beforeEach(() => setOsForTesting('mac'));

  it('has only the root /', () => {
    expect(pathRoot('/Users/a/b.md')).toBe('/');
    expect(pathRoot('C:/Users/a.md')).toBe('');
    expect(isAbsolutePath('//server/share/a.md')).toBe(true);
    expect(pathRoot('//server/share/a.md')).toBe('/');
  });

  it('finds the folder of a path as before', () => {
    expect(parentFolder('/Users/a/b.md')).toBe('/Users/a');
    expect(parentFolder('/b.md')).toBe('/');
    expect(parentFolder('/')).toBe('/');
    expect(parentFolder('b.md')).toBeNull();
    expect(directoryOf('/b.md')).toBe('/');
    expect(parentPath('b.md')).toBe('/');
    expect(exportFolderOf('/b.md')).toBeNull();
    expect(exportFolderOf('/a/b.md')).toBe('/a');
  });

  it('resolves relative hrefs and file: URLs as before', () => {
    expect(joinPath('/a/b', '../c/./d.png')).toBe('/a/c/d.png');
    expect(joinPath('/a', '../../../x')).toBe('/x');
    expect(fileUrl('/a b/c.png')).toBe('file:///a%20b/c.png');
    expect(fileUrlOf('/Users/a/doc.md', '../img/a b.png')).toBe('file:///Users/img/a%20b.png');
    expect(fileUrlOf('/Users/a/doc.md', '/abs/x.png')).toBe('file:///abs/x.png');
  });

  it('compares paths with their case', () => {
    expect(samePath('/a/B.md', '/a/b.md')).toBe(false);
  });

  it('reads C:/ as a scheme in links, as before', () => {
    expect(classifyHref('C:/a.md')).toBe('external');
    expect(classifyImageSource('C:/a.png')).toBe('blocked');
  });
});

describe('paths on Windows', () => {
  beforeEach(() => setOsForTesting('windows'));

  it('knows drive and share roots', () => {
    expect(pathRoot('C:/Users/masud/a.md')).toBe('C:/');
    expect(pathRoot('d:/x')).toBe('d:/');
    expect(pathRoot('//server/share/a.md')).toBe('//server/share/');
    expect(pathRoot('//server/share')).toBe('//server/share/');
    expect(pathRoot('/a')).toBe('/');
    expect(pathRoot('a/b')).toBe('');
    expect(isAbsolutePath('C:/a')).toBe(true);
  });

  it('stops at the root when finding a folder', () => {
    expect(parentFolder('C:/Users/a.md')).toBe('C:/Users');
    expect(parentFolder('C:/a.md')).toBe('C:/');
    expect(parentFolder('C:/')).toBe('C:/');
    expect(parentFolder('//server/share/a.md')).toBe('//server/share/');
    expect(parentFolder('//server/share/x/a.md')).toBe('//server/share/x');
    expect(directoryOf('C:/a.md')).toBe('C:/');
    expect(parentPath('C:/Notes')).toBe('C:/');
    expect(exportFolderOf('C:/a.md')).toBeNull();
    expect(exportFolderOf('C:/Notes/a.md')).toBe('C:/Notes');
  });

  it('never climbs above the drive or the share', () => {
    expect(joinPath('C:/a/b', '../img.png')).toBe('C:/a/img.png');
    expect(joinPath('C:/a', '../../../img.png')).toBe('C:/img.png');
    expect(joinPath('//server/share/a', '../../../x.png')).toBe('//server/share/x.png');
    expect(joinPath('C:/a', 'D:/b/c.png')).toBe('D:/b/c.png');
  });

  it('writes file: URLs with three slashes for a drive and two for a share', () => {
    expect(fileUrl('C:/Users/a b/c.png')).toBe('file:///C:/Users/a%20b/c.png');
    expect(fileUrl('//server/share/c.png')).toBe('file://server/share/c.png');
    expect(fileUrlOf('C:/a/b/doc.md', '../img.png')).toBe('file:///C:/a/img.png');
    expect(fileUrlOf('C:/doc.md', '../../img.png')).toBe('file:///C:/img.png');
  });

  it('compares paths without case', () => {
    expect(samePath('C:/Notes/A.md', 'c:/notes/a.md')).toBe(true);
    expect(samePath('C:/Notes/A.md', 'C:/Notes/B.md')).toBe(false);
  });

  it('walks the Files tree up to a drive root without looping', () => {
    expect(isUnder('C:/a/b.md', 'C:/')).toBe(true);
    expect(ancestorsBelow('C:/', 'C:/a/b/c.md')).toEqual(['C:/a', 'C:/a/b']);
    expect(ancestorsBelow('//server/share', '//server/share/a/b.md')).toEqual(['//server/share/a']);
  });

  it('reads a drive path in a link or an image as a file, not a scheme', () => {
    expect(classifyHref('C:/Notes/a.md')).toBe('document');
    expect(classifyHref('C:/Notes/a.pdf')).toBe('file');
    expect(classifyHref('https://example.com')).toBe('external');
    expect(classifyImageSource('C:/Pictures/a.png')).toBe('local');
    expect(resolveIncludeKey('', 'C:/inc/a.qmd')).toBe('C:/inc/a.qmd');
  });

  it('refuses the file names Windows refuses', () => {
    expect(nameProblem('a?.md')).toMatch(/cannot contain/);
    expect(nameProblem('a\\b.md')).toMatch(/cannot contain/);
    expect(nameProblem('notes.')).toMatch(/end with a dot/);
    expect(nameProblem('CON.md')).toMatch(/reserved by Windows/);
    expect(nameProblem('Console.md')).toBeNull();
    setOsForTesting('mac');
    expect(nameProblem('a?.md')).toBeNull();
    expect(nameProblem('CON.md')).toBeNull();
  });
});
