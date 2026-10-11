/**
 * Real Word export: the request Writedown builds for a
 * fixture is run through the Pandoc inside RStudio with exactly the argument list of 2.8, and the
 * `.docx` is opened with Node's zlib. Expected values come from the fixtures and from Pandoc's own
 * citeproc output (`tests/fixtures/flavors/pandoc/expected/`). Skipped without RStudio. Run with
 * `npm run test:pandoc`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDocxRequest } from '@/export/docx';
import type { FlavorId } from '@/flavors';
import type { Platform } from '@/lib/platform';
import { loadPipeline } from '@/preview/pipeline';

const PANDOC = '/Applications/RStudio.app/Contents/Resources/app/quarto/bin/tools/aarch64/pandoc';
const HAVE_PANDOC = existsSync(PANDOC);
if (!HAVE_PANDOC)
  console.warn('pandoc: RStudio Pandoc not found; the Word export tests are skipped.');

const ROOT = resolve(__dirname, '../..');
const FLAVORS = join(ROOT, 'tests/fixtures/flavors');
const work = mkdtempSync(join(tmpdir(), 'wd-pandoc-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** `word/document.xml` of a .docx (a zip), read with the central directory and zlib. */
function documentXml(file: string): string {
  const zip = readFileSync(file);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  expect(end).toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (name === 'word/document.xml') {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('no word/document.xml');
}

/** The paragraphs of the XML as plain text. */
function paragraphs(xml: string): string[] {
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
      decode([...part.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')),
    )
    .filter((text) => text !== '');
}

/** Plain-text ATX headings outside fences: letters, digits and spaces only. */
function headingsOf(source: string, max = 6): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const match = /^#{1,6} +([A-Za-z0-9 ]+?) *$/.exec(line);
    if (match?.[1]) out.push(match[1]);
    if (out.length >= max) break;
  }
  return out;
}

interface Case {
  name: string;
  flavor: FlavorId;
  path: string;
  /** Strings the paragraphs must contain (a paragraph equal to it, or one that holds it). */
  citation?: string;
  reference?: string;
  /** Paragraphs expected as they are (a fixture without headings). */
  paragraphs?: string[];
  route: string;
}

const CASES: Case[] = [
  { name: 'CommonMark', flavor: 'commonmark', path: 'plain.md', route: 'commonmark' },
  { name: 'GFM', flavor: 'gfm', path: 'plain.md', route: 'gfm+tex_math_dollars' },
  {
    name: 'Pandoc',
    flavor: 'pandoc',
    path: 'pandoc/citations.md',
    route: 'markdown',
    // From pandoc/expected/citations.txt (Pandoc 3.8.3 citeproc output).
    citation: 'Standard citation in brackets: (Smith 2020b)',
    reference: 'Jones, Robert. 2021. Comprehensive Guide to Methods. Academic Press.',
  },
  { name: 'Pandoc headings', flavor: 'pandoc', path: 'pandoc/syntax.md', route: 'markdown' },
  {
    name: 'MMD',
    flavor: 'pandoc',
    path: 'pandoc/title-mmd.mmd',
    route: 'markdown_mmd',
    // The MultiMarkdown metadata of the fixture becomes the title; the body stays a paragraph.
    paragraphs: ['Learning and Evidence in Practice', 'Introduction and main content here.'],
  },
  {
    name: 'Quarto',
    flavor: 'quarto',
    path: '../../../src/content/guides/quarto.md',
    route: 'markdown',
    citation: 'Parenthetical (Lindqvist 2020)',
    reference:
      'Lindqvist, Aino. 2020. “Counting Fictional Lighthouses.” Journal of Imaginary Studies 12: 101–18.',
  },
  { name: 'Obsidian', flavor: 'obsidian', path: 'obsidian/vault/Home.md', route: 'html' },
  { name: 'MDX', flavor: 'mdx', path: 'component.mdx', route: 'html' },
];

describe.skipIf(!HAVE_PANDOC)('Word export through the real Pandoc (C32)', () => {
  for (const item of CASES) {
    it(`${item.name}: the headings${item.citation ? ', a citation and its reference' : ''} reach the .docx`, async () => {
      const path = resolve(FLAVORS, item.path);
      const source = readFileSync(path, 'utf8');
      const pipeline = await loadPipeline(item.flavor);
      const out = join(work, `${item.name.replace(/\W+/g, '-')}.docx`);
      const request = await buildDocxRequest({
        platform: {} as Platform,
        flavor: item.flavor,
        fileName: basename(path),
        docPath: null,
        text: source,
        result: pipeline.render(source),
        outPath: out,
      });
      expect(request.from).toBe(item.route);
      expect(request.citeproc).toBe(item.citation !== undefined);

      // The argument list of, nothing else; the input is on stdin.
      const args = ['-f', request.from];
      if (request.citeproc) args.push('--citeproc');
      args.push('--resource-path', dirname(path), '-o', out);
      execFileSync(PANDOC, args, {
        input: request.input,
        cwd: dirname(path),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const text = paragraphs(documentXml(out));
      const headings = headingsOf(source);
      expect(
        headings.length > 0 || item.citation !== undefined || item.paragraphs !== undefined,
      ).toBe(true);
      for (const paragraph of item.paragraphs ?? []) expect(text).toContain(paragraph);
      for (const heading of headings) expect(text, heading).toContain(heading);
      if (item.citation) expect(text.some((p) => p.includes(item.citation as string))).toBe(true);
      if (item.reference) expect(text).toContain(item.reference);
    });
  }
});
