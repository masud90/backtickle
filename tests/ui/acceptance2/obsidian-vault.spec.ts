/**
 * Phase 2 acceptance, Obsidian: B19 to B22.
 * Expectations come from the vault layout and the fixture files (folder steps counted by hand,
 * the PNG size read from its header), not from the app's output. Run with WD_UI_PORT=1451.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import {
  customVault,
  expect,
  FIXTURES,
  launch,
  openNote,
  preview,
  previewOffset,
  squash,
  texts,
  VAULT_ROOT,
  vaultSeed,
} from './support-b2';

const wikilinks = (page: import('@playwright/test').Page) => preview(page).locator('a.wikilink');
/** Opens the fixture vault's Home note and waits until its last block is rendered. */
async function openHome(
  page: import('@playwright/test').Page,
  view: 'editor' | 'split' | 'preview',
) {
  await launch(page, { seed: vaultSeed(), open: `${VAULT_ROOT}/Home.md`, view });
  await expect(preview(page).locator('h2#mermaid-diagram')).toBeAttached();
}

const tabs = (page: import('@playwright/test').Page) =>
  page.getByTestId('tab-strip').getByRole('tab');

// ---- B19 wikilinks -----------------------------------------------------------------------------

test.describe('B19 wikilinks', () => {
  test('B19 the five forms render their text and carry target, heading and block', async ({
    page,
  }) => {
    await openHome(page, 'preview');
    const link = (target: string, text?: string) =>
      text
        ? wikilinks(page).filter({ hasText: text }).first()
        : wikilinks(page)
            .and(page.locator(`[data-target="${target}"]`))
            .first();

    // [[Note]]
    const plain = wikilinks(page).filter({ hasText: /^Plan$/ });
    await expect(plain).toHaveCount(1);
    await expect(plain).toHaveAttribute('data-target', 'Plan');
    // [[Note|alias]] shows the alias only
    const alias = link('Note A', 'an alias');
    await expect(alias).toHaveText('an alias');
    await expect(alias).toHaveAttribute('data-target', 'Note A');
    // [[Note#Heading]]
    const heading = wikilinks(page).filter({ hasText: 'Note A > Second heading' });
    await expect(heading).toHaveCount(1);
    await expect(heading).toHaveAttribute('data-heading', 'Second heading');
    // [[Note#^block]]
    const block = wikilinks(page).filter({ hasText: 'Note A > ^block1' });
    await expect(block).toHaveCount(1);
    await expect(block).toHaveAttribute('data-block', 'block1');
    // [[#Heading]] points into the current note
    const local = wikilinks(page).filter({ hasText: 'Local heading' });
    await expect(local).toHaveCount(1);
    await expect(local).toHaveAttribute('data-heading', 'Local heading');
    // The path form shows the path as written.
    await expect(wikilinks(page).filter({ hasText: 'Projects/Plan' })).toHaveCount(1);
  });

  test('B19 an exact path resolves with or without .md, and beats a nearer note of the same name', async ({
    page,
  }) => {
    const notes = {
      'Work/Deep/Doc.md': 'First [[Other/Same]] and [[Other/Same.md]] and [[Same]].\n',
      'Work/Same.md': '# Near same\n\nnear body\n',
      'Other/Same.md': '# Far same\n\nfar body\n',
    };
    await openNote(page, notes, 'Work/Deep/Doc.md');
    const exact = wikilinks(page).filter({ hasText: /^Other\/Same(\.md)?$/ });
    await expect(exact).toHaveCount(2);
    await exact.first().click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(page.getByTestId('document-name')).toHaveText('Same.md');
    await expect(preview(page).locator('h1')).toHaveText('Far same');
    // The second form (with .md) opens the same note: the tab is reused, not duplicated.
    await tabs(page).first().click();
    await expect(preview(page).locator('h1')).toHaveCount(0);
    await wikilinks(page)
      .filter({ hasText: /^Other\/Same\.md$/ })
      .click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(preview(page).locator('h1')).toHaveText('Far same');
  });

  test('B19 a bare name goes to the note with the fewest folder steps from the current note', async ({
    page,
  }) => {
    // From Work/Deep: Work/Same.md is 1 step (up one), Work/Deep/Sub/Sub2/Same.md is 2 steps
    // (down two), Other/Same.md is 3 steps (up two, down one).
    const notes = {
      'Work/Deep/Doc.md': 'Go [[Same]].\n',
      'Work/Same.md': '# Same at Work\n',
      'Work/Deep/Sub/Sub2/Same.md': '# Same at Sub2\n',
      'Other/Same.md': '# Same at Other\n',
    };
    await openNote(page, notes, 'Work/Deep/Doc.md');
    await wikilinks(page).first().click();
    await expect(page.getByTestId('document-name')).toHaveText('Same.md');
    await expect(preview(page).locator('h1')).toHaveText('Same at Work');
  });

  test('B19 the fixture vault: [[Plan]] from Home opens Projects/Plan, not Archive/Old/Plan', async ({
    page,
  }) => {
    // Home is at the root: Projects/Plan.md is 1 step down, Archive/Old/Plan.md is 2.
    await openHome(page, 'preview');
    await wikilinks(page)
      .filter({ hasText: /^Plan$/ })
      .click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(preview(page)).toContainText('This is the Projects/Plan.md file.');
  });

  test('B19 ties in folder steps go alphabetically by path', async ({ page }) => {
    // From the root, A-folder/Same.md and B-folder/Same.md are both 1 step.
    const notes = {
      'Doc.md': 'Go [[Same]].\n',
      'B-folder/Same.md': '# From B\n',
      'A-folder/Same.md': '# From A\n',
    };
    await openNote(page, notes, 'Doc.md');
    await wikilinks(page).first().click();
    await expect(preview(page).locator('h1')).toHaveText('From A');
  });

  test('B19 an unresolved link is styled differently from a resolved one and opens nothing', async ({
    page,
  }) => {
    await openHome(page, 'preview');
    const lost = wikilinks(page).filter({ hasText: 'Does Not Exist' });
    await expect(lost).toHaveClass(/is-unresolved/);
    const resolved = wikilinks(page).filter({ hasText: /^Plan$/ });
    await expect(resolved).not.toHaveClass(/is-unresolved/);
    const look = (locator: import('@playwright/test').Locator) =>
      locator.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.color, s.textDecorationLine, s.textDecorationStyle, s.opacity, s.fontStyle].join(
          '|',
        );
      });
    expect(await look(lost)).not.toBe(await look(resolved));
    await lost.click();
    await page.waitForTimeout(300);
    await expect(tabs(page)).toHaveCount(0); // one document: no tab strip
    await expect(page.getByTestId('document-name')).toHaveText('Home.md');
  });

  test('B19 a click on [[Note#Heading]] opens the note at that heading, and [[Note#^block]] at the block', async ({
    page,
  }) => {
    const filler = Array.from({ length: 90 }, (_, i) => `Filler paragraph ${i + 1}.\n`).join('\n');
    const notes = {
      'Index.md': 'Go [[Long#Target heading]] or [[Long#^deep]].\n',
      'Long.md': `# Long\n\n${filler}\n## Target heading\n\nTarget text.\n\n${filler}\nThe deep paragraph. ^deep\n\n${filler}`,
    };
    await openNote(page, notes, 'Index.md', 'split');
    await wikilinks(page).filter({ hasText: 'Long > Target heading' }).click();
    await expect(page.getByTestId('document-name')).toHaveText('Long.md');
    await expect.poll(() => previewOffset(page, 'h2#target-heading')).toBeLessThanOrEqual(48);
    expect(await previewOffset(page, 'h2#target-heading')).toBeGreaterThanOrEqual(-4);

    await tabs(page).first().click();
    await expect(page.getByTestId('document-name')).toHaveText('Index.md');
    await wikilinks(page).filter({ hasText: 'Long > ^deep' }).click();
    await expect(page.getByTestId('document-name')).toHaveText('Long.md');
    await expect.poll(() => previewOffset(page, '[id="^deep"]')).toBeLessThanOrEqual(48);
  });

  test('B19 [[#Heading]] scrolls the current note', async ({ page }) => {
    const filler = Array.from({ length: 90 }, (_, i) => `Filler paragraph ${i + 1}.\n`).join('\n');
    const notes = {
      'Self.md': `Jump [[#Down here]].\n\n${filler}\n## Down here\n\nEnd.\n\n${filler}`,
    };
    await openNote(page, notes, 'Self.md');
    await wikilinks(page).first().click();
    await expect.poll(() => previewOffset(page, 'h2#down-here')).toBeLessThanOrEqual(48);
    await expect(tabs(page)).toHaveCount(0); // still one document
  });
});

// ---- B20 embeds --------------------------------------------------------------------------------

/** Width and height of a PNG, from its header. */
function pngSize(relative: string): { w: number; h: number } {
  const bytes = readFileSync(join(FIXTURES, relative));
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

test.describe('B20 embeds', () => {
  test('B20 an image embed shows the image; |300 sets the width; |300x200 sets both', async ({
    page,
  }) => {
    await openHome(page, 'preview');
    const images = preview(page).locator('img[alt="diagram.png"]');
    await expect(images).toHaveCount(3);
    const size = pngSize('flavors/obsidian/vault/attachments/diagram.png');
    await expect.poll(async () => (await images.nth(0).boundingBox())?.width).toBe(size.w);
    const second = await images.nth(1).boundingBox();
    expect(second?.width).toBe(300);
    expect(Math.round(second?.height ?? 0)).toBe(Math.round((300 * size.h) / size.w));
    const third = await images.nth(2).boundingBox();
    expect(third?.width).toBe(300);
    expect(third?.height).toBe(200);
  });

  test('B20 a note, a section and a block embed show exactly their part', async ({ page }) => {
    await openHome(page, 'preview');
    const embeds = preview(page).locator('.embed[data-target="Note A"]');
    await expect(embeds).toHaveCount(3);
    const [whole, section, block] = [embeds.nth(0), embeds.nth(1), embeds.nth(2)];
    await expect(whole.locator('.embed-content h1')).toHaveText('Note A');
    await expect(whole.locator('.embed-content h2')).toHaveText('Second heading');
    await expect(whole.locator('.embed-content')).toContainText('This is a paragraph in Note A.');

    await expect(section.locator('.embed-content h2')).toHaveText('Second heading');
    await expect(section.locator('.embed-content h1')).toHaveCount(0);
    await expect(section.locator('.embed-content')).toContainText(
      'This is the second heading paragraph.',
    );
    await expect(section.locator('.embed-content')).not.toContainText(
      'This is a paragraph in Note A.',
    );

    await expect(block.locator('.embed-content h1, .embed-content h2')).toHaveCount(0);
    expect(squash(await block.locator('.embed-content').textContent())).toBe(
      'This paragraph ends with a block ID',
    );
    for (const embed of [whole, section, block]) {
      await expect(embed.locator('.embed-title')).toBeVisible();
    }
  });

  test('B20 embedded notes are sanitized like the document and carry no style attribute', async ({
    page,
  }) => {
    const notes = {
      'Host.md': 'Host text.\n\n![[Guest]]\n',
      'Guest.md':
        '# Guest\n\n<img src=x onerror="window.__XSS_SENTINEL__=1">\n\n[bad](javascript:window.__XSS_SENTINEL__=2)\n\n<span style="color:red">styled</span>\n',
    };
    await openNote(page, notes, 'Host.md');
    await expect(preview(page).locator('.embed-content h1')).toHaveText('Guest');
    await expect(preview(page).locator('[onerror], [style]')).toHaveCount(0);
    await expect(preview(page).locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __XSS_SENTINEL__?: unknown }).__XSS_SENTINEL__,
      ),
    ).toBeUndefined();
  });

  test('B20 nesting stops after two levels', async ({ page }) => {
    const notes = {
      'N0.md': 'N0 body.\n\n![[N1]]\n',
      'N1.md': 'N1 body.\n\n![[N2]]\n',
      'N2.md': 'N2 body.\n\n![[N3]]\n',
      'N3.md': 'N3 body.\n\n![[N4]]\n',
      'N4.md': 'N4 body.\n',
    };
    await openNote(page, notes, 'N0.md');
    const content = preview(page);
    await expect(content).toContainText('N1 body.');
    await expect(content).toContainText('N2 body.');
    await expect(content).not.toContainText('N3 body.');
    await expect(content).not.toContainText('N4 body.');
    // The note that would be the third level is shown as a card, not silently dropped.
    await expect(content.locator('.embed[data-target="N3"]')).toHaveCount(1);
  });

  test('B20 a cycle is shown as a muted card and does not loop', async ({ page }) => {
    await launch(page, { seed: vaultSeed(), open: `${VAULT_ROOT}/Cycle A.md`, view: 'preview' });
    await expect(
      preview(page).locator('.embed[data-target="Cycle B"] .embed-content h1'),
    ).toHaveText('Cycle B');
    // Cycle B embeds Cycle A again: that is the document itself, so it is a card, not content.
    const cycle = preview(page).locator('.embed-cycle');
    await expect(cycle).toHaveCount(1);
    await expect(cycle).toContainText(/cycle/i);
    await expect(
      preview(page).locator('.embed[data-target="Cycle A"] .embed-content h1'),
    ).toHaveCount(0);
    expect(await preview(page).locator('.embed').count()).toBeLessThanOrEqual(2);
  });

  test('B20 a PDF embed is a link card, not an inline object', async ({ page }) => {
    await openHome(page, 'preview');
    const card = preview(page).locator('.embed[data-target="report.pdf"]');
    await expect(card).toHaveCount(1);
    await expect(card.locator('a')).toHaveText('report.pdf');
    await expect(card.locator('iframe, object, embed')).toHaveCount(0);
  });

  test('B20 an embed of a missing note is a card and the rest renders', async ({ page }) => {
    await openNote(page, { 'Solo.md': 'Before.\n\n![[Nowhere]]\n\nAfter.\n' }, 'Solo.md');
    await expect(preview(page)).toContainText('Before.');
    await expect(preview(page)).toContainText('After.');
    await expect(preview(page).locator('.embed[data-target="Nowhere"]')).toContainText('Nowhere');
  });

  test('B20 embedded notes count in neither the outline nor the word count', async ({ page }) => {
    await openHome(page, 'split');
    await expect(preview(page).locator('.embed-content h1').first()).toBeAttached();
    const items = (await page.getByTestId('outline-item').allTextContents()).map(squash);
    for (const title of ['Note A', 'Second heading', 'Cycle A', 'Cycle B']) {
      expect(items.join('|')).not.toContain(title);
    }
    expect(items.join('|')).toContain('Wikilinks');

    const notes = {
      'Count.md': 'Alpha beta.\n\n![[Guest]]\n',
      'Guest.md': 'one two three four five six\n',
    };
    await openNote(page, notes, 'Count.md', 'split');
    await expect(preview(page).locator('.embed-content')).toContainText('one two three');
    await expect(page.getByTestId('status-words')).toHaveText(/Words:\s*2\b/);
  });
});

// ---- B21 callouts ------------------------------------------------------------------------------

const GROUPS: string[][] = [
  ['note'],
  ['abstract', 'summary', 'tldr'],
  ['info'],
  ['todo'],
  ['tip', 'hint', 'important'],
  ['success', 'check', 'done'],
  ['question', 'help', 'faq'],
  ['warning', 'caution', 'attention'],
  ['failure', 'fail', 'missing'],
  ['danger', 'error'],
  ['bug'],
  ['example'],
  ['quote', 'cite'],
];

test.describe('B21 callouts', () => {
  test('B21 every type and alias is a callout with its group look, icon and default title', async ({
    page,
  }) => {
    await openHome(page, 'preview');
    let seen = 0;
    for (const group of GROUPS) {
      const look = group[0] as string;
      for (const type of group) {
        const callout = preview(page).locator(`.callout[data-callout="${type}"]`);
        // note also appears as NOTE and with a custom title; tip and warning also with a fold marker.
        expect(await callout.count(), type).toBeGreaterThanOrEqual(1);
        await expect(callout.first(), type).toHaveClass(new RegExp(`callout-${look}\\b`));
        await expect(callout.first().locator('.callout-icon'), type).toHaveCount(1);
        const title = squash(await callout.first().locator('.callout-title').first().textContent());
        expect(title.toLowerCase(), type).toBe(type);
        seen++;
      }
    }
    expect(seen).toBe(27);
  });

  test('B21 types are case-insensitive and unknown types look like a note', async ({ page }) => {
    await openHome(page, 'preview');
    const upper = preview(page).locator('.callout', { hasText: 'This is uppercase' });
    await expect(upper).toHaveClass(/callout-note\b/);
    await expect(upper).toHaveAttribute('data-callout', 'note');
    const unknown = preview(page).locator('.callout', { hasText: 'This is an unknown type' });
    await expect(unknown).toHaveClass(/callout-note\b/);
  });

  test('B21 a custom title replaces the default title and the body stays', async ({ page }) => {
    await openHome(page, 'preview');
    const custom = preview(page).locator('.callout', {
      hasText: 'This callout has a custom title',
    });
    await expect(custom.locator('.callout-title').first()).toHaveText('My Custom Title');
    await expect(custom).toContainText('This callout has a custom title');
  });

  test('B21 + opens and - closes a foldable callout, and the summary toggles it', async ({
    page,
  }) => {
    await openHome(page, 'preview');
    await expect(preview(page).locator('details.callout')).toHaveCount(2);
    const open = preview(page).locator('details.callout[data-callout="tip"]');
    const closed = preview(page).locator('details.callout[data-callout="warning"]');
    await expect(open).toHaveAttribute('open', '');
    await expect(closed).not.toHaveAttribute('open', '');
    await expect(open.locator(':scope > summary.callout-title')).toHaveCount(1);
    await closed.scrollIntoViewIfNeeded();
    await expect(closed.getByText('This callout is collapsed')).toBeHidden();
    await closed.locator('summary').click();
    await expect(closed).toHaveAttribute('open', '');
    await expect(closed.getByText('This callout is collapsed')).toBeVisible();
    await open.locator('summary').click();
    await expect(open).not.toHaveAttribute('open', '');
    // Callouts without a fold marker are not collapsible.
    await expect(
      preview(page).locator('.callout[data-callout="note"]').first(),
    ).not.toHaveJSProperty('tagName', 'DETAILS');
  });
});

// ---- B22 highlights, comments, tags, block ids, properties ------------------------------------

test.describe('B22 inline Obsidian syntax and properties', () => {
  test('B22 ==highlight== gives mark', async ({ page }) => {
    await openHome(page, 'preview');
    expect(await texts(page, 'mark')).toEqual(['important']);
  });

  test('B22 %%comments%% are removed, inline and over several lines', async ({ page }) => {
    await openHome(page, 'preview');
    await expect(
      preview(page).locator('h2', { hasText: 'Highlights and Comments' }),
    ).toBeAttached();
    const text = (await preview(page).textContent()) ?? '';
    expect(text).not.toContain('hidden inline comment');
    expect(text).not.toContain('hidden block comment');
    expect(text).not.toContain('multi-line');
    expect(text).not.toContain('%%');
    // The text around an inline comment stays.
    await openNote(page, { 'C.md': 'Before %%gone%% after.\n' }, 'C.md');
    expect(squash(await preview(page).locator('p').first().textContent())).toMatch(
      /^Before\s+after\.$/,
    );
  });

  test('B22 tags are pills, except in code, numbers only and headings', async ({ page }) => {
    await openHome(page, 'preview');
    expect(await texts(page, 'p span.tag')).toEqual(['#review', '#project/alpha']);
    await expect(preview(page).locator('code span.tag')).toHaveCount(0);
    await expect(preview(page).locator('p', { hasText: '#2024 (not a tag)' })).toBeAttached();

    const notes = {
      'T.md': [
        '# Heading one',
        '',
        'Text with #real and #a/b/c tags and #1234 and #12a.',
        '',
        '```',
        '#in-fence',
        '```',
        '',
      ].join('\n'),
    };
    await openNote(page, notes, 'T.md');
    expect(await texts(page, 'span.tag')).toEqual(['#real', '#a/b/c', '#12a']);
    await expect(preview(page).locator('h1 span.tag')).toHaveCount(0);
    await expect(preview(page).locator('h1')).toHaveText('Heading one');
    await expect(preview(page).locator('pre')).toContainText('#in-fence');
  });

  test('B22 a block id at the end of a block becomes its id and is hidden', async ({ page }) => {
    await openHome(page, 'preview');
    const target = preview(page).locator('p', { hasText: 'A paragraph ending with a block ID' });
    await expect(target).toHaveCount(1);
    const id = await target.getAttribute('id');
    expect(id).toMatch(/^\^?home-1$/);
    expect(squash(await target.textContent())).toBe('A paragraph ending with a block ID');
    expect((await preview(page).textContent()) ?? '').not.toContain('^home-1');
  });

  test('B22 properties are a table of key and value, with pills for tags and lists, dates as written', async ({
    page,
  }) => {
    await openHome(page, 'preview');
    const table = preview(page).locator('table.properties');
    await expect(table).toHaveCount(1);
    const rows = await table.locator('tr').evaluateAll((trs) =>
      trs.map((tr) => ({
        key: (tr.children[0]?.textContent ?? '').trim(),
        pills: [...tr.querySelectorAll('.tag')].map((t) => (t.textContent ?? '').trim()),
        value: (tr.children[1]?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      })),
    );
    expect(rows.map((r) => r.key)).toEqual(['tags', 'status', 'created', 'aliases']);
    expect(rows[0]?.pills.map((p) => p.replace(/^#/, ''))).toEqual(['project', 'review']);
    expect(rows[1]).toMatchObject({ pills: [], value: 'draft' });
    expect(rows[2]).toMatchObject({ pills: [], value: '2026-01-15' });
    expect(rows[3]?.pills).toEqual(['Start']);
    // The GFM frontmatter header is not shown as well.
    await expect(preview(page).locator('header')).toHaveCount(0);
    await expect(
      preview(page).locator('.wd-block').first().locator('table.properties'),
    ).toHaveCount(1);
  });
});

// Keeps the helper imports used even if a case is skipped during triage.
void customVault;
