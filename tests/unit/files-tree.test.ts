import { describe, expect, it } from 'vitest';
import type { FolderEntry } from '@/lib/platform';
import {
  ancestorsBelow,
  extensionOf,
  finalName,
  flattenTree,
  isUnder,
  type Level,
  nameProblem,
  naturalCompare,
  nextNewName,
  parentPath,
  remapPath,
  sortEntries,
  stemOf,
  treeKey,
} from '@/shell/files/tree';

const entry = (name: string, kind: 'file' | 'folder', dir = '/r'): FolderEntry => ({
  name,
  path: `${dir}/${name}`,
  kind,
  bytes: null,
  modifiedMs: null,
});

describe('ordering', () => {
  it('puts chapter 2 before chapter 10 and ignores case', () => {
    expect(naturalCompare('chapter 2.md', 'chapter 10.md')).toBeLessThan(0);
    expect(naturalCompare('a.mdown', 'B.mkd')).toBeLessThan(0);
    expect(naturalCompare('b', 'B')).toBe(0);
  });

  it('lists folders first, then files, each in natural order', () => {
    const sorted = sortEntries([
      entry('chapter 10.md', 'file'),
      entry('zeta', 'folder'),
      entry('chapter 2.md', 'file'),
      entry('Alpha', 'folder'),
    ]).map((e) => e.name);
    expect(sorted).toEqual(['Alpha', 'zeta', 'chapter 2.md', 'chapter 10.md']);
  });

  it('does not change its argument', () => {
    const input = [entry('b', 'file'), entry('a', 'file')];
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(['b', 'a']);
  });
});

describe('flattenTree', () => {
  const levels = new Map<string, Level>([
    ['/r', { entries: [entry('sub', 'folder'), entry('a.md', 'file')], truncated: false }],
    [
      '/r/sub',
      {
        entries: [entry('deep', 'folder', '/r/sub'), entry('b.md', 'file', '/r/sub')],
        truncated: false,
      },
    ],
  ]);

  it('shows only the first level while nothing is expanded', () => {
    expect(flattenTree('/r', levels, new Set()).map((r) => r.name)).toEqual(['sub', 'a.md']);
  });

  it('descends into expanded folders with their level and parent', () => {
    const rows = flattenTree('/r', levels, new Set(['/r/sub']));
    expect(rows.map((r) => [r.name, r.level, r.parent])).toEqual([
      ['sub', 1, '/r'],
      ['deep', 2, '/r/sub'],
      ['b.md', 2, '/r/sub'],
      ['a.md', 1, '/r'],
    ]);
    expect(rows[0]?.expanded).toBe(true);
  });

  it('marks an expanded folder whose level is being listed', () => {
    const rows = flattenTree(
      '/r',
      levels,
      new Set(['/r/sub/deep', '/r/sub']),
      new Set(['/r/sub/deep']),
    );
    expect(rows.find((r) => r.name === 'deep')?.loading).toBe(true);
  });
});

describe('paths', () => {
  it('finds parents and containment', () => {
    expect(parentPath('/r/a/b.md')).toBe('/r/a');
    expect(parentPath('/a.md')).toBe('/');
    expect(isUnder('/r/a', '/r')).toBe(true);
    expect(isUnder('/rr/a', '/r')).toBe(false);
    expect(isUnder('/r', '/r')).toBe(true);
  });

  it('lists the folders above a file, outermost first', () => {
    expect(ancestorsBelow('/r', '/r/a/b/c.md')).toEqual(['/r/a', '/r/a/b']);
    expect(ancestorsBelow('/r', '/r/c.md')).toEqual([]);
    expect(ancestorsBelow('/r', '/elsewhere/c.md')).toEqual([]);
  });

  it('remaps a path below a renamed folder', () => {
    expect(remapPath('/r/a/x.md', '/r/a', '/r/b')).toBe('/r/b/x.md');
    expect(remapPath('/r/a', '/r/a', '/r/b')).toBe('/r/b');
    expect(remapPath('/r/ab/x.md', '/r/a', '/r/b')).toBe('/r/ab/x.md');
  });
});

describe('names', () => {
  it('splits extension and stem', () => {
    expect(extensionOf('notes.md')).toBe('.md');
    expect(extensionOf('.hidden')).toBe('');
    expect(stemOf('chapter 2.md')).toBe('chapter 2');
    expect(stemOf('README')).toBe('README');
  });

  it('keeps the extension unless another Markdown-family one is typed', () => {
    expect(finalName('a.md', 'b', 'file')).toBe('b.md');
    expect(finalName('a.md', 'b.md', 'file')).toBe('b.md');
    expect(finalName('a.md', 'b.txt', 'file')).toBe('b.txt');
    expect(finalName('a.md', 'b.Rmd', 'file')).toBe('b.Rmd');
    expect(finalName('a.md', 'v1.2', 'file')).toBe('v1.2.md');
    expect(finalName('a.md', '  b  ', 'file')).toBe('b.md');
    expect(finalName('sub', 'x.y', 'folder')).toBe('x.y');
  });

  it('names the problems the platform refuses', () => {
    expect(nameProblem('ok.md')).toBeNull();
    expect(nameProblem('')).not.toBeNull();
    expect(nameProblem('a/b.md')).toMatch(/\//);
    expect(nameProblem('a:b.md')).toMatch(/:/);
    expect(nameProblem('.hidden.md')).toMatch(/dot/);
  });

  it('numbers new files from 2, ignoring case', () => {
    expect(nextNewName([], 'Untitled', '.md')).toBe('Untitled.md');
    expect(nextNewName(['Untitled.md'], 'Untitled', '.md')).toBe('Untitled 2.md');
    expect(nextNewName(['untitled.md', 'Untitled 2.md'], 'Untitled', '.md')).toBe('Untitled 3.md');
    expect(nextNewName(['Untitled Folder'], 'Untitled Folder', '')).toBe('Untitled Folder 2');
  });
});

describe('treeKey (WAI-ARIA tree pattern)', () => {
  const rows = flattenTree(
    '/r',
    new Map<string, Level>([
      [
        '/r',
        {
          entries: [entry('sub', 'folder'), entry('empty', 'folder'), entry('a.md', 'file')],
          truncated: false,
        },
      ],
      ['/r/sub', { entries: [entry('b.md', 'file', '/r/sub')], truncated: false }],
    ]),
    new Set(['/r/sub']),
  );
  // sub (0), b.md (1), empty (2), a.md (3)

  it('moves with the arrows and stops at the ends', () => {
    expect(treeKey('ArrowDown', rows, 0)).toEqual({ kind: 'move', to: 1 });
    expect(treeKey('ArrowDown', rows, 3)).toEqual({ kind: 'move', to: 3 });
    expect(treeKey('ArrowUp', rows, 0)).toEqual({ kind: 'move', to: 0 });
    expect(treeKey('Home', rows, 2)).toEqual({ kind: 'move', to: 0 });
    expect(treeKey('End', rows, 0)).toEqual({ kind: 'move', to: 3 });
  });

  it('expands a closed folder, then enters an open one', () => {
    expect(treeKey('ArrowRight', rows, 2)).toEqual({ kind: 'expand', path: '/r/empty' });
    expect(treeKey('ArrowRight', rows, 0)).toEqual({ kind: 'move', to: 1 });
    expect(treeKey('ArrowRight', rows, 3)).toBeNull();
  });

  it('collapses an open folder, else goes to the parent', () => {
    expect(treeKey('ArrowLeft', rows, 0)).toEqual({ kind: 'collapse', path: '/r/sub' });
    expect(treeKey('ArrowLeft', rows, 1)).toEqual({ kind: 'move', to: 0 });
    expect(treeKey('ArrowLeft', rows, 3)).toBeNull();
  });

  it('opens a file and toggles a folder with Return', () => {
    expect(treeKey('Enter', rows, 3)).toEqual({ kind: 'open', path: '/r/a.md' });
    expect(treeKey('Enter', rows, 2)).toEqual({ kind: 'toggle', path: '/r/empty' });
    expect(treeKey('x', rows, 0)).toBeNull();
  });
});
