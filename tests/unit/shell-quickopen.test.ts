import { describe, expect, it } from 'vitest';
import type { MenuState, RecentEntry } from '@/lib/platform';
import type { Command } from '@/shell/commands';
import { listedCommands, paletteRows } from '@/shell/palette/rows';
import { buildCandidates, pickerRows } from '@/shell/quickopen/candidates';

const recent = (path: string, folder: string, exists = true): RecentEntry => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  folder,
  openedAtMs: 0,
  bytes: 1,
  exists,
});

describe('Quick Open candidates', () => {
  const input = {
    tabs: ['/r/b.md'],
    recents: [
      recent('/r/b.md', '~/r'),
      recent('/h/z.md', '~/h'),
      recent('/h/gone.md', '~/h', false),
    ],
    folder: '/r',
    folderFiles: ['/r/a.md', '/r/b.md', '/r/sub/c.md'],
  };

  it('orders open tabs, recents, then folder files, each path once, without missing recents', () => {
    const candidates = buildCandidates(input);
    expect(candidates.map((c) => c.path)).toEqual(['/r/b.md', '/h/z.md', '/r/a.md', '/r/sub/c.md']);
    expect(candidates.map((c) => c.source)).toEqual(['tab', 'recent', 'folder', 'folder']);
  });

  it('shows the folder relative to the open folder, and the recent folder outside it', () => {
    const candidates = buildCandidates(input);
    expect(candidates.map((c) => c.folder)).toEqual(['', '~/h', '', 'sub']);
    expect(candidates.map((c) => c.text)).toEqual(['b.md', '~/h/z.md', 'a.md', 'sub/c.md']);
  });

  it('works without a folder', () => {
    const candidates = buildCandidates({
      tabs: [],
      recents: input.recents,
      folder: null,
      folderFiles: [],
    });
    expect(candidates.map((c) => c.path)).toEqual(['/r/b.md', '/h/z.md']);
  });

  it('keeps the order for an empty query', () => {
    const rows = pickerRows(buildCandidates(input), '  ');
    expect(rows.map((r) => r.id)).toEqual(['/r/b.md', '/h/z.md', '/r/a.md', '/r/sub/c.md']);
    expect(rows[3]).toMatchObject({ label: 'c.md', detail: 'sub' });
  });

  it('ranks by the relative path and marks the characters in the name', () => {
    const candidates = buildCandidates({
      tabs: [],
      recents: [],
      folder: '/r',
      folderFiles: ['/r/notes/other.md', '/r/docs/note.md'],
    });
    // Scores (fuzzy.test.ts): "docs/note.md" 31, "notes/other.md" 23.
    const rows = pickerRows(candidates, 'note');
    expect(rows.map((r) => r.id)).toEqual(['/r/docs/note.md', '/r/notes/other.md']);
    // "note" sits at 5..8 of "docs/note.md"; the name "note.md" starts at 5.
    expect(rows[0]?.matches).toEqual([0, 1, 2, 3]);
    // In "notes/other.md" the match is in the folder part: nothing to mark in the name.
    expect(rows[1]?.matches).toEqual([]);
  });

  it('shows at most 100 rows', () => {
    const files = Array.from({ length: 150 }, (_, i) => `/r/f${i}.md`);
    const rows = pickerRows(
      buildCandidates({ tabs: [], recents: [], folder: '/r', folderFiles: files }),
      '',
    );
    expect(rows).toHaveLength(100);
  });
});

describe('palette rows', () => {
  const state = { hasDocument: false } as MenuState;
  const cmd = (id: string, label: string, ok: boolean, shortcut?: string): Command => ({
    id,
    label,
    shortcut,
    enabled: () => ok,
    run: () => {},
  });
  const all = [
    cmd('save', 'Save', false, '⌘S'),
    cmd('new', 'New', true, '⌘N'),
    cmd('command-palette', 'Command Palette…', true, '⇧⌘P'),
    cmd('view-split', 'View: Split', true, '⌘2'),
  ];

  it('lists enabled commands except the palette itself', () => {
    expect(listedCommands(all, state).map((c) => c.id)).toEqual(['new', 'view-split']);
  });

  it('keeps the registry order for an empty query and shows shortcuts', () => {
    expect(paletteRows(listedCommands(all, state), '')).toEqual([
      { id: 'new', label: 'New', detail: '⌘N' },
      { id: 'view-split', label: 'View: Split', detail: '⌘2' },
    ]);
  });

  it('filters by the label with matched characters', () => {
    // "split" at 6..10 of "View: Split".
    const rows = paletteRows(listedCommands(all, state), 'split');
    expect(rows.map((r) => r.id)).toEqual(['view-split']);
    expect(rows[0]?.matches).toEqual([6, 7, 8, 9, 10]);
  });
});
