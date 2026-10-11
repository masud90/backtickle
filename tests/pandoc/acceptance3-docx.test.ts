/**
 * Phase 3 acceptance C32 (WP3.8a2), real Pandoc: each flavor's fixture goes through the Pandoc
 * inside RStudio with the exact argument list of the Word export and the `.docx` is read
 * with Node's zlib. The Markdown routes are run directly on the fixture files (the expected
 * values are the fixtures' headings and Pandoc 3.8.3's own citeproc output in
 * `tests/fixtures/flavors/pandoc/expected/citations.txt`); only the two HTML routes (Obsidian,
 * MDX) need the app to produce the HTML. Skipped without RStudio. Run with `npm run test:pandoc`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDocxRequest } from '@/export/docx';
import type { FlavorId } from '@/flavors';
import type { Platform } from '@/lib/platform';
import { loadPipeline } from '@/preview/pipeline';

const PANDOC = '/Applications/RStudio.app/Contents/Resources/app/quarto/bin/tools/aarch64/pandoc';
const HAVE = existsSync(PANDOC);
if (!HAVE) console.warn('C32: the Pandoc inside RStudio was not found; the tests are skipped.');

const ROOT = resolve(__dirname, '../..');
const FLAVORS = join(ROOT, 'tests/fixtures/flavors');
const work = mkdtempSync(join(tmpdir(), 'wd-acc3-docx-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The text of `word/document.xml` of a .docx, one string per paragraph. */
function docxParagraphs(file: string): string[] {
  const zip = readFileSync(file);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  let xml = '';
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === 'word/document.xml') {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      xml = (method === 0 ? data : inflateRawSync(data)).toString('utf8');
      break;
    }
    at += 46 + nameLength + extra + comment;
  }
  if (xml === '') throw new Error('no word/document.xml');
  const decode = (text: string) =>
    text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  return xml
    .split('</w:p>')
    .map((part) =>
      decode([...part.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1] ?? '').join('')),
    )
    .filter((text) => text !== '');
}

/** Plain ATX headings outside fences and front matter (letters, digits and spaces only). */
function plainHeadings(source: string): string[] {
  const found: string[] = [];
  let fenced = false;
  let front = source.startsWith('---\n');
  for (const [index, line] of source.split('\n').entries()) {
    if (front) {
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const match = /^#{1,6} +([A-Za-z0-9 ]+?) *$/.exec(line);
    if (match?.[1]) found.push(match[1]);
  }
  return found;
}

/** Runs Pandoc with exactly the arguments of; the input goes to stdin. */
function runPandoc(opts: {
  from: string;
  citeproc: boolean;
  input: string;
  folder: string;
  out: string;
}) {
  const args = ['-f', opts.from];
  if (opts.citeproc) args.push('--citeproc');
  args.push('--resource-path', opts.folder, '-o', opts.out);
  const run = spawnSync(PANDOC, args, { input: opts.input, cwd: opts.folder, encoding: 'utf8' });
  expect(run.stderr.trim().split('\n')[0] ?? '', 'pandoc stderr').not.toMatch(/error/i);
  expect(run.status).toBe(0);
  return docxParagraphs(opts.out);
}

const CITATIONS_TXT = readFileSync(join(FLAVORS, 'pandoc/expected/citations.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '');

interface Case {
  name: string;
  /** Path relative to tests/fixtures/flavors, or absolute. */
  file: string;
  from: string;
  citeproc: boolean;
  expectLines?: string[];
}

const MARKDOWN_CASES: Case[] = [
  { name: 'CommonMark', file: 'plain.md', from: 'commonmark', citeproc: false },
  {
    name: 'GFM',
    file: join(ROOT, 'src/content/guides/gfm.md'),
    from: 'gfm+tex_math_dollars',
    citeproc: false,
  },
  { name: 'Pandoc syntax', file: 'pandoc/syntax.md', from: 'markdown', citeproc: false },
  {
    name: 'Pandoc citations',
    file: 'pandoc/citations.md',
    from: 'markdown',
    citeproc: true,
    // Pandoc 3.8.3 citeproc output, copied by the fixture author into expected/citations.txt.
    expectLines: CITATIONS_TXT.filter(
      (line) =>
        line.startsWith('Standard citation in brackets:') ||
        line.startsWith('Narrative citation:') ||
        line.startsWith('Jones, Robert. 2021.') ||
        line.startsWith('Taylor, George. n.d.') ||
        line.startsWith('United Nations High Commissioner for Refugees. 2022.'),
    ),
  },
  {
    name: 'MMD',
    file: 'pandoc/title-mmd.mmd',
    from: 'markdown_mmd',
    citeproc: false,
    expectLines: ['Introduction and main content here.'],
  },
  {
    name: 'Quarto',
    file: join(ROOT, 'src/content/guides/quarto.md'),
    from: 'markdown',
    citeproc: true,
    expectLines: ['Parenthetical (Lindqvist 2020)'],
  },
];

describe.skipIf(!HAVE)('C32 Word export through the real Pandoc', () => {
  for (const item of MARKDOWN_CASES) {
    it(`${item.name}: headings${item.expectLines ? ', citations and references' : ''} are in the .docx`, () => {
      const path = item.file.startsWith('/') ? item.file : join(FLAVORS, item.file);
      const source = readFileSync(path, 'utf8');
      const out = join(work, `${item.name.replace(/\W+/g, '-')}.docx`);
      const text = runPandoc({
        from: item.from,
        citeproc: item.citeproc,
        input: source,
        folder: dirname(path),
        out,
      });
      const headings = plainHeadings(source);
      expect(headings.length > 0 || item.expectLines !== undefined).toBe(true);
      for (const heading of headings) expect(text, heading).toContain(heading);
      for (const line of item.expectLines ?? []) {
        expect(
          text.some((paragraph) => paragraph.includes(line)),
          line,
        ).toBe(true);
      }
    });
  }

  for (const [name, flavor, file] of [
    ['Obsidian', 'obsidian', 'obsidian/vault/Home.md'],
    ['MDX', 'mdx', 'component.mdx'],
  ] as Array<[string, FlavorId, string]>) {
    it(`${name}: the document HTML the app builds converts, with the headings`, async () => {
      const path = join(FLAVORS, file);
      const source = readFileSync(path, 'utf8');
      const pipeline = await loadPipeline(flavor);
      const out = join(work, `${name}.docx`);
      const request = await buildDocxRequest({
        platform: {} as Platform,
        flavor,
        fileName: basename(path),
        docPath: null,
        text: source,
        result: pipeline.render(source),
        outPath: out,
      });
      expect(request.from).toBe('html');
      expect(request.citeproc).toBe(false);
      const text = runPandoc({
        from: request.from,
        citeproc: false,
        input: request.input,
        folder: dirname(path),
        out,
      });
      const headings = plainHeadings(source);
      expect(headings.length).toBeGreaterThan(0);
      for (const heading of headings) expect(text, heading).toContain(heading);
    });
  }

  it('metadata in a document cannot add arguments or run a filter', () => {
    const folder = mkdtempSync(join(work, 'hostile-'));
    const marker = join(folder, 'filter-ran');
    writeFileSync(
      join(folder, 'evil.lua'),
      `local f = io.open(${JSON.stringify(marker)}, 'w'); f:write('ran'); f:close()\nreturn {}\n`,
    );
    const source =
      '---\nlua-filter: evil.lua\nfilters: [evil.lua]\npandoc-args: [--lua-filter, evil.lua]\n---\n\n# Hostile\n\n--lua-filter=evil.lua\n';
    const text = runPandoc({
      from: 'markdown',
      citeproc: false,
      input: source,
      folder,
      out: join(folder, 'out.docx'),
    });
    expect(text).toContain('Hostile');
    expect(existsSync(marker)).toBe(false);
  });
});
