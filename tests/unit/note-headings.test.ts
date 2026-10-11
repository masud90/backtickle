import { describe, expect, it } from 'vitest';
import { createMockPlatform, type MockSeed } from '@/lib/platform-mock';
import { noteHeadingsFor } from '@/shell/noteheadings';

// The expected headings are written by hand from the seeded note texts.
const seed: MockSeed = {
  files: {
    '/v/Home.md': '# Home\n',
    '/v/Notes/Plan.md': '# Plan\n\n## Goals ##\n\n```\n# not a heading\n```\n\n### Risks\n',
    '/v/Archive/Plan.md': '# Old plan\n',
    '/outside.md': '# Outside\n',
  },
  vault: { root: '/v' },
  launch: { openPath: '/v/Home.md' },
};

async function setup() {
  const platform = createMockPlatform(seed);
  await platform.launchOptions();
  const vault = await platform.vaultIndex('/v/Home.md');
  return { platform, vault };
}

describe('noteHeadingsFor', () => {
  it('reads the headings of the note a name resolves to in the vault', async () => {
    const { platform, vault } = await setup();
    const headings = noteHeadingsFor(platform, () => '/v/Home.md', vault);

    // Two notes are called Plan, one folder step from Home: ties go to the alphabetical first.
    expect(await headings('Plan')).toEqual(['Old plan']);
    expect(await headings('Notes/Plan')).toEqual(['Plan', 'Goals', 'Risks']);
    expect(await headings('Archive/Plan')).toEqual(['Old plan']);
  });

  it('gives an empty list for an unknown note, no vault, no path or a read error', async () => {
    const { platform, vault } = await setup();

    expect(await noteHeadingsFor(platform, () => '/v/Home.md', vault)('Missing')).toEqual([]);
    expect(await noteHeadingsFor(platform, () => '/v/Home.md', null)('Plan')).toEqual([]);
    expect(await noteHeadingsFor(platform, () => null, vault)('Plan')).toEqual([]);
    const failing = { readLinkedText: () => Promise.reject(new Error('no')) };
    expect(await noteHeadingsFor(failing, () => '/v/Home.md', vault)('Plan')).toEqual([]);
  });

  it('follows the document path as it is when the list is asked for', async () => {
    const { platform, vault } = await setup();
    let path: string | null = null;
    const headings = noteHeadingsFor(platform, () => path, vault);

    expect(await headings('Home')).toEqual([]);
    path = '/v/Home.md';
    expect(await headings('Home')).toEqual(['Home']);
  });
});
