import { describe, expect, it } from 'vitest';
import type { PlatformError } from '@/lib/platform';
import { createMockPlatform, type MockSeed } from '@/lib/platform-mock';

function mock(seed: MockSeed) {
  const platform = createMockPlatform(seed);
  const control = window.__WRITEDOWN_MOCK__;
  if (!control) throw new Error('the mock control object is missing');
  return { platform, control };
}

async function ready(seed: MockSeed) {
  const made = mock(seed);
  await made.platform.launchOptions();
  return made;
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as PlatformError).code;
  }
  return undefined;
}

const MB = 1024 * 1024;

describe('mock platform: readLinkedText', () => {
  const seed: MockSeed = {
    files: {
      '/docs/index.md': '# i',
      '/docs/refs.bib': '@book{a}',
      '/docs/refs.json': '[]',
      '/docs/_part.qmd': 'part\r\ntwo',
      '/docs/note.md': 'n',
      '/docs/script.sh': 'echo',
      '/docs/big.bib': { text: 'x', bytes: 10 * MB + 1 },
      '/docs/fits.bib': { text: 'x', bytes: 10 * MB },
      '/docs/big.md': { text: 'x', bytes: 5 * MB + 1 },
      '/other/x.md': 'x',
    },
    existing: ['/docs/folder.md'],
    launch: { openPath: '/docs/index.md' },
  };

  it('reads each purpose and normalizes line endings', async () => {
    const { platform } = await ready(seed);

    expect(await platform.readLinkedText('/docs/index.md', 'refs.bib', 'bibliography')).toEqual({
      path: '/docs/refs.bib',
      text: '@book{a}',
    });
    expect(
      (await platform.readLinkedText('/docs/index.md', 'refs.json', 'bibliography')).text,
    ).toBe('[]');
    expect((await platform.readLinkedText('/docs/index.md', '_part.qmd#x', 'include')).text).toBe(
      'part\ntwo',
    );
    expect((await platform.readLinkedText('/docs/index.md', '../other/x.md', 'include')).path).toBe(
      '/other/x.md',
    );
  });

  it('refuses the wrong extension for each purpose', async () => {
    const { platform } = await ready(seed);

    expect(await code(platform.readLinkedText('/docs/index.md', 'note.md', 'bibliography'))).toBe(
      'not-allowed',
    );
    expect(await code(platform.readLinkedText('/docs/index.md', 'refs.bib', 'include'))).toBe(
      'not-markdown',
    );
    expect(await code(platform.readLinkedText('/docs/index.md', 'script.sh', 'include'))).toBe(
      'not-markdown',
    );
    expect(await code(platform.readLinkedText('/docs/index.md', '_part.qmd', 'embed'))).toBe(
      'not-markdown',
    );
    expect(await code(platform.readLinkedText('/docs/index.md', 'folder.md', 'include'))).toBe(
      'not-markdown',
    );
  });

  it('applies the size limits by purpose', async () => {
    const { platform } = await ready(seed);

    expect((await platform.readLinkedText('/docs/index.md', 'fits.bib', 'bibliography')).text).toBe(
      'x',
    );
    expect(await code(platform.readLinkedText('/docs/index.md', 'big.bib', 'bibliography'))).toBe(
      'too-large',
    );
    expect(await code(platform.readLinkedText('/docs/index.md', 'big.md', 'include'))).toBe(
      'too-large',
    );
  });

  it('reports a missing target, other schemes and a document that is not granted', async () => {
    const { platform } = await ready(seed);

    expect(await code(platform.readLinkedText('/docs/index.md', 'nope.bib', 'bibliography'))).toBe(
      'not-found',
    );
    expect(
      await code(platform.readLinkedText('/docs/index.md', 'https://x.org/a.bib', 'bibliography')),
    ).toBe('not-allowed');
    expect(await code(platform.readLinkedText('/other/x.md', 'a.bib', 'bibliography'))).toBe(
      'not-allowed',
    );
  });

  it('gives the target a read-only grant: it can start linked reads, nothing else', async () => {
    const { platform, control } = await ready({
      ...seed,
      files: { ...(seed.files as object), '/docs/inc/deep.md': 'deep' },
    });

    await platform.readLinkedText('/docs/index.md', '_part.qmd', 'include');
    await platform.readLinkedText('/docs/index.md', 'inc/deep.md', 'include');

    expect((await platform.readLinkedText('/docs/inc/deep.md', '../note.md', 'include')).text).toBe(
      'n',
    );
    expect(await code(platform.readDocument('/docs/inc/deep.md'))).toBe('not-allowed');
    expect(control.granted).not.toContain('/docs/inc/deep.md');
    expect(await platform.recentDocuments()).toEqual([]);
  });

  it('embeds only inside the vault of the document', async () => {
    const { platform } = await ready({
      files: {
        '/v/Home.md': 'home',
        '/v/Notes/A.md': 'a',
        '/outside.md': 'o',
        '/v/Notes/a.qmd': 'q',
      },
      vault: { root: '/v' },
      launch: { openPath: '/v/Home.md' },
    });

    expect((await platform.readLinkedText('/v/Home.md', 'Notes/A.md', 'embed')).text).toBe('a');
    expect(await code(platform.readLinkedText('/v/Home.md', '../outside.md', 'embed'))).toBe(
      'not-allowed',
    );
    expect((await platform.readLinkedText('/v/Home.md', '../outside.md', 'include')).text).toBe(
      'o',
    );
  });

  it('refuses an embed from a document outside every vault', async () => {
    const { platform } = await ready(seed);

    expect(await code(platform.readLinkedText('/docs/index.md', 'note.md', 'embed'))).toBe(
      'not-allowed',
    );
  });
});

describe('mock platform: vaultIndex', () => {
  const files = {
    '/v/Home.md': 'h',
    '/v/Notes/Note A.md': 'a',
    '/v/Archive/Old/Plan.md': 'p',
    '/v/.hidden/Secret.md': 's',
    '/v/.trash/Old.md': 'o',
    '/v/.obsidian/app.json': '{}',
    '/v/node_modules/x/README.md': 'r',
    '/v/Notes/readme.txt': 't',
    '/outside.md': 'o',
  };

  it('lists notes and attachments relative to the root and skips hidden and skipped folders', async () => {
    const { platform } = await ready({
      files,
      images: { '/v/attachments/diagram.png': 'asset://x' },
      existing: ['/v/attachments/report.pdf', '/v/attachments/data.csv'],
      vault: { root: '/v' },
      launch: { openPath: '/v/Home.md' },
    });

    expect(await platform.vaultIndex('/v/Home.md')).toEqual({
      root: '/v',
      notes: ['Archive/Old/Plan.md', 'Home.md', 'Notes/Note A.md'],
      attachments: ['attachments/diagram.png', 'attachments/report.pdf'],
      truncated: false,
    });
  });

  it('is null outside a vault and refuses a document that is not granted', async () => {
    const { platform, control } = await ready({
      files,
      vault: { root: '/v' },
      launch: { openPath: '/v/Home.md' },
    });
    control.openFiles(['/outside.md']);

    expect(await platform.vaultIndex('/outside.md')).toBeNull();
    expect(await code(platform.vaultIndex('/v/Notes/Note A.md'))).toBe('not-allowed');
  });

  it('stops at 20,000 entries and says so', async () => {
    const many: Record<string, string> = { '/v/Home.md': 'h' };
    for (let i = 0; i < 20_001; i++) many[`/v/n/${i}.md`] = '';
    const { platform } = await ready({
      files: many,
      vault: { root: '/v' },
      launch: { openPath: '/v/Home.md' },
    });

    const index = await platform.vaultIndex('/v/Home.md');

    expect(index?.truncated).toBe(true);
    expect((index?.notes.length ?? 0) + (index?.attachments.length ?? 0)).toBe(20_000);
  });

  it('resolves a vault-relative image from a note in a sub-folder, and only inside the vault', async () => {
    const { platform } = await ready({
      files: { '/v/Notes/Note A.md': 'a', '/v/Home.md': 'h' },
      images: {
        '/v/attachments/diagram.png': 'asset://diagram',
        '/outside.png': 'asset://outside',
      },
      vault: { root: '/v' },
      launch: { openPath: '/v/Notes/Note A.md' },
    });

    expect(await platform.resolveImage('/v/Notes/Note A.md', 'attachments/diagram.png')).toBe(
      'asset://diagram',
    );
    expect(await code(platform.resolveImage('/v/Notes/Note A.md', '../outside.png'))).toBe(
      'not-found',
    );
    expect(await code(platform.resolveImage('/v/Notes/Note A.md', 'attachments/none.png'))).toBe(
      'not-found',
    );
  });
});

describe('mock platform: quartoProject', () => {
  it('finds the nearest _quarto.yml and stops at the home folder and after eight levels', async () => {
    const deep = '/Users/mock/p/a/b/c/d/e/f/g/doc.qmd';
    const { platform } = await ready({
      files: {
        '/Users/mock/p/_quarto.yml': 'project: 1',
        '/Users/mock/p/a/b/_quarto.yml': 'near: 1',
        '/Users/mock/_quarto.yml': 'home: 1',
        '/Users/mock/q/doc.qmd': 'x',
        [deep]: 'x',
        '/Users/mock/p/a/b/c/doc.qmd': 'x',
        '/Users/mock/p/doc.qmd': 'x',
      },
      launch: { openPath: '/Users/mock/p/a/b/c/doc.qmd' },
    });
    const { control } = { control: window.__WRITEDOWN_MOCK__ };
    control?.openFiles([deep, '/Users/mock/q/doc.qmd', '/Users/mock/p/doc.qmd']);

    expect(await platform.quartoProject('/Users/mock/p/a/b/c/doc.qmd')).toEqual({
      path: '/Users/mock/p/a/b/_quarto.yml',
      text: 'near: 1',
    });
    expect((await platform.quartoProject('/Users/mock/p/doc.qmd'))?.text).toBe('project: 1');
    // g, f, e, d, c, b: b holds one, so it is found; the deep document is 8 folders from p.
    expect((await platform.quartoProject(deep))?.text).toBe('near: 1');
    // The home folder's own file is never used.
    expect(await platform.quartoProject('/Users/mock/q/doc.qmd')).toBeNull();
  });

  it('gives up after eight folders', async () => {
    const doc = '/Users/mock/a/b/c/d/e/f/g/h/i/doc.qmd';
    const { platform } = await ready({
      files: { '/Users/mock/a/_quarto.yml': 'far: 1', [doc]: 'x' },
      launch: { openPath: doc },
    });

    // i, h, g, f, e, d, c, b are the eight folders; a is the ninth.
    expect(await platform.quartoProject(doc)).toBeNull();
  });

  it('refuses a project file over one megabyte', async () => {
    const { platform } = await ready({
      files: { '/p/_quarto.yml': { text: 'x', bytes: MB + 1 }, '/p/doc.qmd': 'x' },
      launch: { openPath: '/p/doc.qmd' },
    });

    expect(await code(platform.quartoProject('/p/doc.qmd'))).toBe('too-large');
  });
});
