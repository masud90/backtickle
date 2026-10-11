// The Obsidian pack sanitizes with DOMPurify, which needs jsdom.
// @vitest-environment jsdom
/**
 * The Obsidian pack: the fixture vault's
 * Home.md through the pack with the vault index of the mock platform, link resolution, callouts,
 * highlights, comments, tags, block ids, properties, the malicious file and the word counts.
 * Expected values come from the fixture files, the spec's lists, and word counts done by hand in
 * the comments.
 */
import { describe, expect, it } from 'vitest';
import { createMockPlatform } from '@/lib/platform-mock';
import { createObsidianPipeline } from '@/preview/packs/obsidian';
import {
  folderSteps,
  noteName,
  pathInVault,
  relativeHref,
  resolveFile,
  resolveNote,
} from '@/preview/rules/obsidian/resolve';
import xssSource from '../fixtures/xss/phase2/obsidian.md?raw';
import { FIXTURE_VAULT, fixtureText, inputs, VAULT_ROOT, vaultSeed } from './obsidian-helpers';
import { parseHtml } from './preview-helpers';

const pipeline = createObsidianPipeline();

function render(
  source: string,
  path: string | null = `${VAULT_ROOT}/Home.md`,
  vault = FIXTURE_VAULT,
) {
  const context = pipeline.prepare?.(source, inputs(path, vault));
  const result = pipeline.render(source, context);
  return { result, root: parseHtml(result.blocks.map((block) => block.html).join('\n')) };
}

const HOME = fixtureText('Home.md');

describe('the mock platform gives the index the pack expects', () => {
  it('lists the fixture vault like the backend', async () => {
    const platform = createMockPlatform(vaultSeed());
    await platform.launchOptions();
    expect(await platform.vaultIndex(`${VAULT_ROOT}/Home.md`)).toEqual(FIXTURE_VAULT);
  });
});

describe('link resolution', () => {
  const vault = {
    root: '/v',
    truncated: false,
    attachments: ['a/pic.png', 'b/pic.png'],
    notes: ['B/Plan.md', 'A/Plan.md', 'Plan.md', 'Deep/er/Plan.md', 'Notes/Note A.md', 'x/Y.md'],
  };

  it('prefers the exact path, with or without the extension', () => {
    expect(resolveNote(vault, 'Deep/er/x.md', 'Plan')).toBe('Plan.md');
    expect(resolveNote(vault, 'Deep/er/x.md', 'A/Plan')).toBe('A/Plan.md');
    expect(resolveNote(vault, 'Deep/er/x.md', 'A/Plan.md')).toBe('A/Plan.md');
    expect(resolveNote(vault, null, 'Notes/Note A')).toBe('Notes/Note A.md');
  });

  it('otherwise takes the nearest by folder steps, ties alphabetical', () => {
    const noRoot = { ...vault, notes: vault.notes.filter((path) => path !== 'Plan.md') };
    // From Deep/er: Deep/er/Plan.md is 0 steps.
    expect(resolveNote(noRoot, 'Deep/er/x.md', 'Plan')).toBe('Deep/er/Plan.md');
    // From x: A, B and Deep/er are 2, 2 and 3 steps away (up one, down one; up one, down two).
    expect(resolveNote(noRoot, 'x/Y.md', 'Plan')).toBe('A/Plan.md');
    // From B/: B/Plan.md itself, but a link to "Plan" from a folder equally far from A and B:
    expect(resolveNote({ ...noRoot, notes: ['B/Plan.md', 'A/Plan.md'] }, 'C/z.md', 'Plan')).toBe(
      'A/Plan.md',
    );
  });

  it('finds a note by the end of its path and without regard to case', () => {
    expect(resolveNote(vault, null, 'er/plan')).toBe('Deep/er/Plan.md');
    expect(resolveNote(vault, null, 'note a')).toBe('Notes/Note A.md');
    expect(resolveNote(vault, null, 'Missing')).toBeNull();
    expect(resolveNote(null, null, 'Plan')).toBeNull();
  });

  it('resolves attachments the same way', () => {
    expect(resolveFile(vault, 'b/n.md', 'pic.png')).toBe('b/pic.png');
    expect(resolveFile(vault, 'a/n.md', 'pic.png')).toBe('a/pic.png');
    expect(resolveFile(vault, null, 'a/pic.png')).toBe('a/pic.png');
    expect(resolveFile(vault, null, 'nope.png')).toBeNull();
  });

  it('counts folder steps and writes relative hrefs', () => {
    expect(folderSteps('a/b/n.md', 'a/c/m.md')).toBe(2);
    expect(folderSteps(null, 'a/m.md')).toBe(1);
    expect(relativeHref('Projects/Plan.md', 'attachments/my pic.png')).toBe(
      '../attachments/my%20pic.png',
    );
    expect(relativeHref(null, 'Notes/Note A.md')).toBe('Notes/Note%20A.md');
    expect(pathInVault(vault, '/v/Notes/x.md')).toBe('Notes/x.md');
    expect(pathInVault(vault, '/other/x.md')).toBeNull();
    expect(noteName('Notes/Note A.md')).toBe('Note A');
  });
});

describe('B19 wikilinks: Home.md', () => {
  const { root } = render(HOME);
  const link = (text: string) =>
    [...root.querySelectorAll('a.wikilink')].find(
      (a) => a.textContent === text,
    ) as HTMLAnchorElement;

  it('resolves [[Plan]] to the nearer of the two Plan.md files', () => {
    const plan = link('Plan');
    expect(plan.getAttribute('href')).toBe('Projects/Plan.md');
    expect(plan.getAttribute('data-target')).toBe('Plan');
    expect(plan.classList.contains('is-unresolved')).toBe(false);
  });

  it('shows the alias, the note name with its heading, and the note name with its block', () => {
    expect(link('an alias').getAttribute('href')).toBe('Notes/Note%20A.md');
    const heading = link('Note A > Second heading');
    expect(heading.getAttribute('href')).toBe('Notes/Note%20A.md#second-heading');
    expect(heading.getAttribute('data-heading')).toBe('Second heading');
    const block = link('Note A > ^block1');
    expect(block.getAttribute('href')).toBe('Notes/Note%20A.md#%5Eblock1');
    expect(block.getAttribute('data-block')).toBe('block1');
  });

  it('links [[#Local heading]] to the heading of the same note, which exists', () => {
    const local = link('Local heading');
    expect(local.getAttribute('href')).toBe('#local-heading');
    expect(root.querySelector('[id="local-heading"]')?.tagName).toBe('H2');
  });

  it('marks an unresolved link, with no href', () => {
    const missing = link('Does Not Exist');
    expect(missing.classList.contains('is-unresolved')).toBe(true);
    expect(missing.hasAttribute('href')).toBe(false);
  });

  it('writes the href from the note that holds the link', () => {
    const { root: nested } = render('[[Plan]] and [[Note A]]\n', `${VAULT_ROOT}/Notes/Note A.md`);
    const hrefs = [...nested.querySelectorAll('a.wikilink')].map((a) => a.getAttribute('href'));
    // From Notes/: Projects/Plan.md (2 steps) beats Archive/Old/Plan.md (3 steps).
    expect(hrefs).toEqual(['../Projects/Plan.md', 'Note%20A.md']);
  });

  it('is unresolved everywhere when the note is in no vault, but a heading link still works', () => {
    const { root: alone } = render('[[Plan]] [[#Top]]\n\n# Top\n', null, null as never);
    const links = [...alone.querySelectorAll('a.wikilink')];
    expect(links[0]?.classList.contains('is-unresolved')).toBe(true);
    expect(links[1]?.getAttribute('href')).toBe('#top');
  });

  it('reads a table cell link with an escaped bar', () => {
    const { root: table } = render('| a |\n|---|\n| [[Note A\\|alias]] |\n');
    expect(table.querySelector('td a.wikilink')?.textContent).toBe('alias');
    expect(table.querySelector('td a.wikilink')?.getAttribute('href')).toBe('Notes/Note%20A.md');
  });
});

describe('B20 embeds: Home.md (placeholders; the content is filled after sanitizing)', () => {
  const { root } = render(HOME);

  it('draws an image with its size', () => {
    const images = [...root.querySelectorAll('img')];
    expect(images).toHaveLength(3);
    expect(images.map((image) => image.getAttribute('data-wd-src'))).toEqual([
      'attachments/diagram.png',
      'attachments/diagram.png',
      'attachments/diagram.png',
    ]);
    expect(images.map((image) => image.getAttribute('data-wd-width'))).toEqual([
      null,
      '300px',
      '300px',
    ]);
    expect(images.map((image) => image.getAttribute('data-wd-height'))).toEqual([
      null,
      null,
      '200px',
    ]);
    expect(root.querySelector('[style]')).toBeNull();
  });

  it('draws a placeholder for a note, a section and a block', () => {
    const embeds = [...root.querySelectorAll('div.embed[data-target="Note A"]')];
    expect(embeds).toHaveLength(3);
    expect(embeds.map((e) => e.getAttribute('data-heading'))).toEqual([
      null,
      'Second heading',
      null,
    ]);
    expect(embeds.map((e) => e.getAttribute('data-block'))).toEqual([null, null, 'block1']);
    for (const embed of embeds) {
      expect(embed.getAttribute('data-href')).toBe('Notes/Note%20A.md');
      expect(embed.getAttribute('data-from')).toBe('/v/Home.md');
      expect(embed.querySelector(':scope > .embed-title')).not.toBeNull();
      expect(embed.querySelector(':scope > .embed-content')?.textContent).toBe('');
    }
    expect(embeds[1]?.querySelector('.embed-title')?.textContent).toBe('Note A > Second heading');
  });

  it('draws a link card for a PDF', () => {
    const card = root.querySelector('div.embed.embed-file[data-target="report.pdf"]');
    expect(card?.querySelector('a')?.getAttribute('href')).toBe('attachments/report.pdf');
  });

  it('shows an unresolved note embed as a muted card', () => {
    const { root: lost } = render('![[Nope]]\n');
    const card = lost.querySelector('div.embed.is-unresolved');
    expect(card?.textContent).toContain('Note not found: Nope');
  });
});

describe('B21 callouts: Home.md', () => {
  const { root } = render(HOME);
  const LOOKS: Record<string, string> = {
    note: 'note',
    abstract: 'abstract',
    summary: 'abstract',
    tldr: 'abstract',
    info: 'info',
    todo: 'todo',
    tip: 'tip',
    hint: 'tip',
    important: 'tip',
    success: 'success',
    check: 'success',
    done: 'success',
    question: 'question',
    help: 'question',
    faq: 'question',
    warning: 'warning',
    caution: 'warning',
    attention: 'warning',
    failure: 'failure',
    fail: 'failure',
    missing: 'failure',
    danger: 'danger',
    error: 'danger',
    bug: 'bug',
    example: 'example',
    quote: 'quote',
    cite: 'quote',
  };

  it('knows every type and alias of the spec', () => {
    for (const [type, look] of Object.entries(LOOKS)) {
      const callout = root.querySelector(`.callout[data-callout="${type}"]`);
      expect(callout, type).not.toBeNull();
      expect(callout?.classList.contains(`callout-${look}`), type).toBe(true);
      expect(
        callout?.querySelector(':scope > .callout-title > .callout-icon[data-icon]'),
      ).not.toBeNull();
    }
  });

  it('gives the default title as the type, capitalized', () => {
    expect(root.querySelector('.callout[data-callout="warning"] .callout-title')?.textContent).toBe(
      'Warning',
    );
    expect(root.querySelector('.callout[data-callout="note"] .callout-title')?.textContent).toBe(
      'Note',
    );
  });

  it('takes a custom title', () => {
    const titles = [...root.querySelectorAll('.callout-title')].map((t) => t.textContent);
    expect(titles).toContain('My Custom Title');
  });

  it('folds with details: open for +, closed for -', () => {
    const open = root.querySelector('details.callout[data-callout="tip"]');
    expect(open?.hasAttribute('open')).toBe(true);
    expect(open?.querySelector(':scope > summary.callout-title')).not.toBeNull();
    const closed = root.querySelector('details.callout[data-callout="warning"]');
    expect(closed?.hasAttribute('open')).toBe(false);
    expect(root.querySelectorAll('details.callout')).toHaveLength(2);
  });

  it('styles an unknown type as a note and reads any case', () => {
    expect(
      root.querySelector('.callout[data-callout="custom"]')?.classList.contains('callout-note'),
    ).toBe(true);
    const upper = [...root.querySelectorAll('.callout[data-callout="note"]')];
    expect(upper.length).toBeGreaterThanOrEqual(2); // [!note] and [!NOTE]
  });

  it('keeps the other content of the callout and handles a title with Markdown', () => {
    const { root: one } = render('> [!tip] A **bold** title\n> body one\n> body two\n');
    const title = one.querySelector('.callout-title');
    expect(title?.querySelector('strong')?.textContent).toBe('bold');
    expect(one.querySelector('.callout')?.textContent).toContain('body one');
  });
});

describe('B22 highlights, comments, tags, block ids, properties: Home.md', () => {
  const { root } = render(HOME);

  it('highlights', () => {
    expect([...root.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['important']);
  });

  it('removes comments, inline and over several lines', () => {
    const text = root.textContent ?? '';
    expect(text).not.toContain('hidden inline comment');
    expect(text).not.toContain('multi-line');
    expect(text).not.toContain('%%');
    expect(text).toContain('This is');
  });

  it('draws tags, but not numbers only and not code', () => {
    const tags = [...root.querySelectorAll('p span.tag')].map((t) => t.textContent);
    expect(tags).toEqual(['#review', '#project/alpha']);
    expect(root.textContent).toContain('#2024 (not a tag)');
    expect(root.querySelector('code')?.textContent).toBe('#tag');
  });

  it('moves a block id to the block and hides it', () => {
    const block = root.querySelector('p[id="^home-1"]');
    expect(block?.textContent).toBe('A paragraph ending with a block ID');
  });

  it('keeps inline footnotes', () => {
    expect(root.querySelector('sup.footnote-ref')).not.toBeNull();
    expect(root.querySelector('li.footnote-item')?.textContent).toContain('inline note');
  });

  it('shows the properties as a table instead of the frontmatter header', () => {
    expect(root.querySelector('header.wd-frontmatter')).toBeNull();
    const rows = [...root.querySelectorAll('table.properties tr')];
    expect(rows.map((row) => row.querySelector('th')?.textContent)).toEqual([
      'tags',
      'status',
      'created',
      'aliases',
    ]);
    expect([...(rows[0]?.querySelectorAll('td .tag') ?? [])].map((t) => t.textContent)).toEqual([
      '#project',
      '#review',
    ]);
    expect(rows[1]?.querySelector('td')?.textContent).toBe('draft');
    expect(rows[2]?.querySelector('td')?.textContent).toBe('2026-01-15');
    expect([...(rows[3]?.querySelectorAll('td .tag') ?? [])].map((t) => t.textContent)).toEqual([
      'Start',
    ]);
  });

  it('renders the diagram fence as the Mermaid placeholder', () => {
    expect(root.querySelector('div.mermaid-diagram pre.mermaid-source')).not.toBeNull();
  });

  it('puts block ids on list items and on the block before a lone id', () => {
    const { root: lists } = render('- item one ^li1\n- item two\n\n> quote\n\n^q1\n');
    expect(lists.querySelector('li[id="^li1"]')?.textContent).toContain('item one');
    expect(lists.querySelector('li[id="^li1"]')?.textContent).not.toContain('^');
    expect(lists.querySelector('blockquote[id="^q1"]')).not.toBeNull();
    expect(lists.textContent).not.toContain('^q1');
  });
});

describe('words', () => {
  const stats = (source: string) => render(source).result.stats;

  it('counts what the reader sees and nothing else', () => {
    // Hello(1) big world(2) and(1) an alias(2) tag(1) here(1) = 8, the comment and the id are out;
    // My title(2) body text(2) = 4; folded text(2) = 2. The embeds and the properties add nothing.
    const source = [
      '---',
      'title: T',
      'tags: [a, b]',
      '---',
      '',
      'Hello ==big world== and %%secret words%% [[Note A|an alias]] #tag here ^b1',
      '',
      '> [!note] My title',
      '> body text',
      '',
      '> [!tip]-',
      '> folded text',
      '',
      '![[Note A]]',
      '',
      '![[diagram.png|100]]',
      '',
      '%%',
      'hidden block',
      '%%',
      '',
    ].join('\n');
    expect(stats(source).words).toBe(14);
  });

  it('counts the name of a link without an alias', () => {
    // Note A (2 words)
    expect(stats('[[Note A]]\n').words).toBe(2);
  });

  it('gives the default title no words', () => {
    expect(stats('> [!warning]\n> two words\n').words).toBe(2);
  });
});

describe('malicious notes', () => {
  const FORBIDDEN =
    'script, iframe, object, embed, form, input, button, textarea, select, option, style, meta, base, link, template, dialog, svg, math, video, audio, source, picture, noscript';

  it('executes nothing and keeps no dangerous attribute', () => {
    const { root } = render(xssSource);
    expect(root.querySelectorAll(FORBIDDEN)).toHaveLength(0);
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name).not.toMatch(/^on/i);
        expect(attribute.name).not.toBe('style');
        // A data-* attribute is inert text; only addresses matter.
        if (['href', 'src', 'xlink:href', 'action'].includes(attribute.name)) {
          expect(attribute.value.replace(/\s/g, '').toLowerCase()).not.toMatch(/^javascript:/);
        }
      }
    }
    expect((globalThis as { __XSS_SENTINEL__?: unknown }).__XSS_SENTINEL__).toBeUndefined();
    // The wikilink to a javascript: address resolves to nothing, so it has no href at all.
    const wiki = [...root.querySelectorAll('a.wikilink')].find((a) =>
      (a.getAttribute('data-target') ?? '').startsWith('javascript:'),
    );
    expect(wiki?.hasAttribute('href')).toBe(false);
  });
});

describe('an unclosed block comment (3.L item 2, C38)', () => {
  it('hides everything to the end of the document, as Obsidian does', () => {
    const { root } = render('Before.\n\n%%\nhidden one\n\nhidden two\n\n# Hidden heading\n');
    const text = root.textContent ?? '';
    expect(text).toContain('Before.');
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('Hidden heading');
  });
  it('still shows what follows a closed comment', () => {
    const { root } = render('%%\nhidden\n%%\n\nShown.\n');
    expect(root.textContent).toContain('Shown.');
    expect(root.textContent).not.toContain('hidden');
  });
});
