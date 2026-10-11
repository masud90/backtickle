/**
 * Phase 2 acceptance, shared behavior: B26 (block lines and
 * block replacement), B27 (sync scroll and outline on long documents), B28 (task toggling), one
 * document per flavor. Run with WD_UI_PORT=1451.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, test } from '@playwright/test';
import {
  blocks,
  choose,
  customVault,
  DOCS,
  editorText,
  expect,
  FIXTURES,
  fixture,
  launch,
  menu,
  openDoc,
  preview,
  setSelection,
  VAULT_ROOT,
  vaultSeed,
} from './support-b2';

const BIB = (name: string) => readFileSync(join(FIXTURES, 'flavors', 'pandoc', name), 'utf8');

interface Case {
  flavor: string;
  pill: RegExp;
  path: string;
  /** The document's text for B26. */
  source: string;
  /** Extra files of the mock (bibliography, other notes). */
  extra: Record<string, string>;
  vault?: boolean;
  /** The last block that shows the document is fully rendered. */
  last: string;
}

const REFS = { [`${DOCS}/refs.bib`]: BIB('refs.bib') };

const CASES: Case[] = [
  {
    flavor: 'pandoc',
    pill: /^Pandoc/,
    path: `${DOCS}/citations.md`,
    source: fixture('flavors/pandoc/citations.md'),
    extra: REFS,
    last: '.references',
  },
  {
    flavor: 'quarto',
    pill: /^Quarto/,
    path: `${DOCS}/crossref.qmd`,
    source: fixture('flavors/quarto/crossref.qmd'),
    extra: {},
    last: 'span.eq-number',
  },
  {
    flavor: 'obsidian',
    pill: /^Obsidian/,
    path: `${VAULT_ROOT}/Home.md`,
    source: fixture('flavors/obsidian/vault/Home.md'),
    extra: {},
    vault: true,
    last: '.mermaid-diagram',
  },
  {
    flavor: 'mdx',
    pill: /^MDX/,
    path: `${DOCS}/components.mdx`,
    source: fixture('flavors/mdx/components.mdx'),
    extra: {},
    last: '.footnotes',
  },
];

async function openCase(
  page: Page,
  c: Case,
  text: string,
  view: 'split' | 'preview' = 'split',
  extra: Record<string, string> = {},
  last: string = c.last,
) {
  if (c.vault) {
    const seed = vaultSeed();
    seed.files[c.path] = text;
    for (const [path, body] of Object.entries(extra)) seed.files[path] = body;
    await launch(page, { seed, open: c.path, view });
  } else {
    await launch(page, {
      seed: { files: { [c.path]: text, ...c.extra, ...extra } },
      open: c.path,
      view,
    });
  }
  await expect(page.getByTestId('status-flavor')).toHaveText(
    c.flavor === 'pandoc'
      ? 'Pandoc / MMD'
      : c.flavor === 'quarto'
        ? 'Quarto / RMD'
        : c.flavor === 'obsidian'
          ? 'Obsidian'
          : 'MDX',
  );
  await expect(preview(page).locator(last).first()).toBeAttached();
}

// ---- B26 ---------------------------------------------------------------------------------------

interface Row {
  line: number;
  end: number;
  exception: boolean;
  text: string;
}

const readRows = (page: Page): Promise<Row[]> =>
  blocks(page).evaluateAll((els) =>
    els.map((el) => ({
      line: Number(el.getAttribute('data-line')),
      end: Number(el.getAttribute('data-end-line')),
      // Phase 1 exceptions: footnotes render last; the reference list sits at its anchor.
      exception: el.querySelector('.footnotes, div.references') !== null,
      text: (el.textContent ?? '').trim().slice(0, 30),
    })),
  );

for (const c of CASES) {
  test(`B26 ${c.flavor}: top-level blocks have increasing data-line values; an edit replaces only the changed block`, async ({
    page,
  }) => {
    const target = 'Plain edit target paragraph.';
    const text = `${c.source.replace(/\s+$/, '')}\n\n${target}\n`;
    await openCase(page, c, text);
    const rows = await readRows(page);
    expect(rows.length).toBeGreaterThan(5);
    const lineCount = text.split('\n').length;
    const main = rows.filter((r) => !r.exception);
    for (const row of rows) {
      expect(row.line, row.text).toBeGreaterThanOrEqual(0);
      expect(row.end, row.text).toBeGreaterThanOrEqual(row.line);
      expect(row.end, row.text).toBeLessThan(lineCount);
    }
    const lines = main.map((r) => r.line);
    expect(lines, `lines of ${c.flavor} blocks`).toEqual([...new Set(lines)].sort((a, b) => a - b));
    // The edit target is the last block in line order, on its own line of the source.
    const targetLine = text.split('\n').indexOf(target);
    expect(main.at(-1)?.line).toBe(targetLine);

    await blocks(page).evaluateAll((els) => {
      (window as unknown as { __kept: Element[] }).__kept = els;
    });
    const identity = () =>
      blocks(page).evaluateAll((els) =>
        els.map((el, i) => el === (window as unknown as { __kept: Element[] }).__kept[i]),
      );
    const targetIndex = rows.findIndex((r) => r.line === targetLine && !r.exception);
    const offset = (await editorText(page)).indexOf(target) + target.length;
    await setSelection(page, offset);
    await page.keyboard.type(' and more');
    await expect(blocks(page).nth(targetIndex)).toContainText(
      'Plain edit target paragraph. and more',
    );
    const kept = await identity();
    expect(kept.length).toBe(rows.length);
    expect(kept.map((k, i) => (k ? null : i)).filter((i) => i !== null)).toEqual([targetIndex]);
  });
}

// ---- B27 ---------------------------------------------------------------------------------------

const SECTION_COUNT = 8;
const TITLES = Array.from({ length: SECTION_COUNT }, (_, i) => `Section ${i + 1}`);

function paragraphs(section: number): string[] {
  return Array.from(
    { length: 14 },
    (_, j) => `Paragraph ${j + 1} of Section ${section}. Some words to fill the line.\n`,
  );
}

/** A long document of the flavor: 8 sections with generated blocks that must not enter the outline. */
function longDocument(flavor: string): { text: string; extra: Record<string, string> } {
  const out: string[] = [];
  const extra: Record<string, string> = {};
  if (flavor === 'pandoc') out.push('---', 'bibliography: refs.bib', '---', '');
  if (flavor === 'quarto') out.push('---', 'title: Long Quarto', '---', '');
  if (flavor === 'mdx') out.push('import { Callout } from "./c.js"', '');
  if (flavor === 'obsidian')
    extra[`${VAULT_ROOT}/Embedded.md`] = '# Embedded heading\n\nEmbedded body.\n';
  for (let i = 1; i <= SECTION_COUNT; i++) {
    out.push(`# Section ${i}`, '', ...paragraphs(i));
    if (flavor === 'pandoc') out.push(`A citation [@smith2020] in section ${i}.`, '');
    if (flavor === 'quarto') {
      out.push(`![Figure caption ${i}](a.png){#fig-s${i}}`, '', `See @fig-s${i}.`, '');
      if (i === 2 || i === 5) {
        out.push(
          '::: {.panel-tabset}',
          '',
          '## Tab One',
          'First tab.',
          '',
          '## Tab Two',
          'Second tab.',
          '',
          ':::',
          '',
        );
      }
    }
    if (flavor === 'obsidian') out.push('![[Embedded]]', '', '> [!note]', '> A callout.', '');
    if (flavor === 'mdx')
      out.push('<Callout type="info">', '', `Inside section ${i}.`, '', '</Callout>', '');
    out.push(`## Part ${i}`, '', ...paragraphs(i).slice(0, 6));
  }
  if (flavor === 'pandoc') out.push('::: {#refs}', ':::', '');
  return { text: `${out.join('\n')}\n`, extra };
}

const lineOf = (doc: string, heading: string) => doc.split('\n').indexOf(heading);

const offsetOfHeading = (page: Page, title: string) =>
  page.evaluate((t) => {
    const h = [
      ...document.querySelectorAll('[data-testid="preview"] h1, [data-testid="preview"] h2'),
    ].find((el) => (el.textContent ?? '').trim() === t) as HTMLElement | undefined;
    const s = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
    return h ? h.getBoundingClientRect().top - s.getBoundingClientRect().top : Number.NaN;
  }, title);

const editorOffset = (page: Page, line: number) =>
  page.evaluate((n) => {
    const content = document.querySelector('[data-testid="editor"] .cm-content') as HTMLElement & {
      cmTile?: {
        view?: {
          state: { doc: { line(n: number): { from: number } } };
          lineBlockAt(p: number): { top: number };
          scrollDOM: HTMLElement;
        };
      };
    };
    const view = content.cmTile?.view;
    if (!view) return Number.NaN;
    return view.lineBlockAt(view.state.doc.line(n + 1).from).top - view.scrollDOM.scrollTop;
  }, line);

async function scrollEditorTo(page: Page, line: number) {
  await page.evaluate(async (n) => {
    const content = document.querySelector('[data-testid="editor"] .cm-content') as HTMLElement & {
      cmTile?: {
        view?: {
          state: { doc: { line(n: number): { from: number } } };
          lineBlockAt(p: number): { top: number };
          scrollDOM: HTMLElement;
        };
      };
    };
    const view = content.cmTile?.view;
    if (!view) throw new Error('no editor view');
    for (let i = 0; i < 8; i++) {
      const top = view.lineBlockAt(view.state.doc.line(n + 1).from).top;
      if (Math.abs(top - view.scrollDOM.scrollTop) <= 1) break;
      view.scrollDOM.scrollTop = top;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  }, line);
}

for (const c of CASES) {
  test(`B27 ${c.flavor}: the outline lists only real headings and clicking one scrolls both panes within 24 px`, async ({
    page,
  }) => {
    const { text, extra } = longDocument(c.flavor);
    await openCase(page, c, text, 'split', extra, 'h2#part-8');
    const items = page.getByTestId('outline-item');
    const expected: RegExp[] = [];
    for (const title of TITLES) {
      expected.push(new RegExp(`${title}$`), new RegExp(`Part ${title.split(' ')[1]}$`));
    }
    await expect(items).toHaveText(expected);
    const heading = await items.allTextContents();
    for (const forbidden of ['Tab One', 'Tab Two', 'Embedded heading', 'References']) {
      expect(heading.join('|')).not.toContain(forbidden);
    }
    for (const n of [3, 7]) {
      const title = `Section ${n}`;
      const line = lineOf(text, `# ${title}`);
      await items.filter({ hasText: new RegExp(`${title}$`) }).click();
      await expect(page.getByTestId('status-position')).toHaveText(
        new RegExp(`^Ln ${line + 1}, Col `),
      );
      await expect
        .poll(async () => Math.abs(await offsetOfHeading(page, title)))
        .toBeLessThanOrEqual(24);
      await expect
        .poll(async () => Math.abs(await editorOffset(page, line)))
        .toBeLessThanOrEqual(24);
    }
  });

  test(`B27 ${c.flavor}: sync scroll keeps the panes within 24 px, editor to preview and back`, async ({
    page,
  }) => {
    const { text, extra } = longDocument(c.flavor);
    await openCase(page, c, text, 'split', extra, 'h2#part-8');
    await expect(page.getByTestId('status-sync')).toHaveText(/Sync Scroll: On/);
    const scroller = page.getByTestId('preview-scroll');
    const editorPane = page.locator('[data-testid="editor"]');
    await expect(preview(page).locator('h1', { hasText: 'Section 8' })).toBeAttached();

    const line5 = lineOf(text, '# Section 5');
    await editorPane.hover();
    await scrollEditorTo(page, line5);
    await expect
      .poll(async () => Math.abs(await offsetOfHeading(page, 'Section 5')))
      .toBeLessThanOrEqual(24);

    await page.waitForTimeout(800);
    const line7 = lineOf(text, '# Section 7');
    await scroller.hover();
    await page.evaluate(() => {
      const h = [...document.querySelectorAll('[data-testid="preview"] h1')].find(
        (el) => (el.textContent ?? '').trim() === 'Section 7',
      ) as HTMLElement;
      const s = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
      s.scrollTop += h.getBoundingClientRect().top - s.getBoundingClientRect().top;
    });
    await expect
      .poll(async () => Math.abs(await editorOffset(page, line7)))
      .toBeLessThanOrEqual(24);
  });
}

// ---- B28 ---------------------------------------------------------------------------------------

const TASKS = ['- [ ] one', '- [x] two', '1. [ ] numbered', '- [ ] parent', '  - [ ] child'];
const flip = (line: string) =>
  line.includes('[ ]') ? line.replace('[ ]', '[x]') : line.replace('[x]', '[ ]');

for (const c of CASES) {
  test(`B28 ${c.flavor}: clicking a task box toggles its source line, once per click, and undo restores it`, async ({
    page,
  }) => {
    const body = `${c.flavor === 'pandoc' ? '' : ''}# Tasks\n\n${TASKS.join('\n')}\n`;
    const path = c.vault
      ? `${VAULT_ROOT}/Tasks.md`
      : c.path.replace(/[^/]+$/, `tasks${c.path.slice(c.path.lastIndexOf('.'))}`);
    if (c.vault) {
      const seed = vaultSeed();
      seed.files[path] = body;
      await launch(page, { seed, open: path, view: 'preview' });
    } else {
      await launch(page, { seed: { files: { [path]: body } }, open: path, view: 'preview' });
      // A plain .md has no flavor of its own: the pill gives it one (the others are detected).
      if (path.endsWith('.md')) await choose(page, c.pill);
    }
    const boxes = preview(page).locator('span.task-checkbox');
    await expect(boxes).toHaveCount(5);
    const original = `${body}`;
    expect(await editorText(page)).toBe(original);
    const lines = body.split('\n');
    const first = lines.indexOf(TASKS[0] as string);
    for (let i = 0; i < TASKS.length; i++) {
      const expected = lines.map((line, j) => (j === first + i ? flip(line) : line));
      await boxes.nth(i).click();
      await expect.poll(() => editorText(page), { message: `box ${i}` }).toBe(expected.join('\n'));
      await expect(boxes.nth(i)).toHaveAttribute(
        'aria-checked',
        TASKS[i]?.includes('[ ]') ? 'true' : 'false',
      );
      await menu(page, 'undo');
      await expect.poll(() => editorText(page)).toBe(original);
    }
    // Space on a focused box does the same.
    await boxes.nth(1).focus();
    await page.keyboard.press('Space');
    await expect
      .poll(() => editorText(page))
      .toBe(lines.map((line, j) => (j === first + 1 ? flip(line) : line)).join('\n'));
  });
}

void customVault;
void openDoc;
