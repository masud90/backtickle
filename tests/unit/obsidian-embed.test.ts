// @vitest-environment jsdom
/**
 * Embedded notes (B20 at unit level) and the click-time wikilink: the embed code reads notes
 * through the mock platform's readLinkedText and fills the placeholders of Home.md.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPlatform } from '@/lib/platform';
import { enhanceBlock } from '@/preview/enhance';
import { createObsidianPipeline } from '@/preview/packs/obsidian';
import {
  extractBlock,
  extractHeading,
  stripFrontmatter,
} from '@/preview/rules/obsidian/embed-section';
import { followWikilink, wikilinkOf } from '@/shell/wikilinks';
import { FIXTURE_VAULT, fixtureText, inputs, VAULT_ROOT, vaultSeed } from './obsidian-helpers';

beforeAll(async () => {
  window.__BACKTICKLE_MOCK_SEED__ = vaultSeed();
  await (await getPlatform()).launchOptions();
});

async function page(source: string, path = `${VAULT_ROOT}/Home.md`): Promise<HTMLElement> {
  const pipeline = createObsidianPipeline();
  const context = pipeline.prepare?.(source, inputs(path));
  const root = document.createElement('div');
  root.innerHTML = pipeline
    .render(source, context)
    .blocks.map((b) => b.html)
    .join('');
  document.body.append(root);
  const work = enhanceBlock(root, { resolveImage: null, images: new Map() });
  await Promise.all(work);
  // Embeds fill after the chunk loads: wait for them to settle.
  for (let i = 0; i < 50 && root.querySelector('.is-loading'); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return root;
}

describe('the section of a note', () => {
  const note = fixtureText('Notes/Note A.md');
  it('takes a heading section and a block, and drops frontmatter', () => {
    expect(extractHeading(note, 'Second heading')).toContain(
      'This is the second heading paragraph.',
    );
    expect(extractHeading(note, 'Second heading')).not.toContain('# Note A');
    expect(extractHeading(note, 'Nope')).toBeNull();
    expect(extractBlock(note, 'block1')).toBe('This paragraph ends with a block ID');
    expect(stripFrontmatter('---\na: 1\n---\nbody')).toBe('body');
  });
});

describe('embedded notes in Home.md', () => {
  it('fills a note, a section and a block, without ids or block wrappers', async () => {
    const root = await page('![[Note A]]\n\n![[Note A#Second heading]]\n\n![[Note A#^block1]]\n');
    const contents = [...root.querySelectorAll('.embed-content')];
    expect(contents).toHaveLength(3);
    expect(contents[0]?.querySelector('h1')?.textContent).toBe('Note A');
    expect(contents[1]?.textContent).toContain('second heading paragraph');
    expect(contents[1]?.textContent).not.toContain('This is a paragraph in Note A');
    expect(contents[2]?.textContent?.trim()).toBe('This paragraph ends with a block ID');
    expect(
      root.querySelectorAll(
        '.embed-content [id], .embed-content .wd-block, .embed-content [data-line]',
      ),
    ).toHaveLength(0);
  });

  it('stops at a cycle with a muted card, and shows two levels', async () => {
    const root = await page(fixtureText('Home.md').split('## Highlights')[0] as string);
    const cycle = root.querySelector('.embed[data-target="Cycle A"]');
    // Home > Cycle A > Cycle B > (Cycle A is open higher up)
    expect(cycle?.querySelector('.embed[data-target="Cycle B"]')).not.toBeNull();
    expect(cycle?.querySelector('.embed-cycle')?.textContent).toContain('embed cycle');
  });

  it('shows the nesting limit', async () => {
    const platform = await getPlatform();
    expect(platform).toBeDefined();
    // Cycle chain A > B shows B's embed as a cycle, never a third level of real content.
    const root = await page('![[Cycle B]]\n');
    expect(root.querySelectorAll('.embed-content .embed-content .embed-content h1')).toHaveLength(
      0,
    );
  });
});

describe('a click on a wikilink', () => {
  it('opens the nearer Plan.md and scrolls to the heading', async () => {
    const platform = await getPlatform();
    const opened: string[] = [];
    const scrolled: string[] = [];
    const root = document.createElement('div');
    root.innerHTML = '<a class="wikilink" data-target="Plan" data-heading="Goals">Plan</a>';
    const link = wikilinkOf(root.querySelector('a'));
    expect(link).toEqual({ target: 'Plan', heading: 'Goals', block: null });
    const result = await followWikilink(
      {
        platform,
        open: async (path) => void opened.push(path),
        scrollTo: async (id) => void scrolled.push(id),
      },
      `${VAULT_ROOT}/Home.md`,
      link as never,
    );
    expect(result).toBe('opened');
    expect(opened).toEqual([`${VAULT_ROOT}/Projects/Plan.md`]);
    expect(scrolled).toEqual(['goals']);
    expect(FIXTURE_VAULT.notes).toContain('Projects/Plan.md');
  });

  it('reports an unresolved link', async () => {
    const result = await followWikilink(
      { platform: await getPlatform(), open: async () => {}, scrollTo: async () => {} },
      `${VAULT_ROOT}/Home.md`,
      { target: 'Missing', heading: null, block: null },
    );
    expect(result).toBe('unresolved');
  });
});
