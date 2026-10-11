/**
 * WP5.11, real Pandoc: the exact preview's argument list run on one
 * document per flavor. The expected text comes from the fixtures (headings) and from Pandoc
 * 3.8.3's own citeproc output in `tests/fixtures/flavors/pandoc/expected/citations.txt`.
 * The HTML then goes through the preview's sanitizer. Skipped without RStudio.
 * Run with `npm run test:pandoc`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizePandocHtml } from '@/preview/pandoc-preview/sanitize';

const PANDOC = '/Applications/RStudio.app/Contents/Resources/app/quarto/bin/tools/aarch64/pandoc';
const HAVE = existsSync(PANDOC);
if (!HAVE) console.warn('WP5.11: the Pandoc inside RStudio was not found; the tests are skipped.');

const ROOT = resolve(__dirname, '../..');
const FLAVORS = join(ROOT, 'tests/fixtures/flavors');

/** The argument list of; the input goes to stdin, HTML comes from stdout. */
function render(from: string, input: string, folder: string, citeproc = false): string {
  const args = ['--from', from, '--to', 'html5', '--mathml'];
  if (citeproc) args.push('--citeproc');
  args.push('--resource-path', folder);
  const run = spawnSync(PANDOC, args, { input, cwd: folder, encoding: 'utf8' });
  expect(run.stderr.split('\n')[0] ?? '', 'pandoc stderr').not.toMatch(/error/i);
  expect(run.status).toBe(0);
  return run.stdout;
}

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe.skipIf(!HAVE)('WP5.11 exact preview through the real Pandoc', () => {
  const cases: Array<[string, string, string]> = [
    ['CommonMark', 'commonmark', join(FLAVORS, 'plain.md')],
    ['GFM', 'gfm', join(ROOT, 'src/content/guides/gfm.md')],
    ['Pandoc / MMD', 'markdown', join(FLAVORS, 'pandoc/syntax.md')],
    ['Quarto / RMD', 'markdown', join(FLAVORS, 'report.qmd')],
  ];
  for (const [name, from, file] of cases) {
    it(`${name} renders and survives the sanitizer`, () => {
      const source = readFileSync(file, 'utf8');
      const folder = file.slice(0, file.lastIndexOf('/'));
      const html = render(from, source, folder);
      expect(html.length).toBeGreaterThan(20);
      // Every plain heading of the source is a heading of the output.
      const headings = [...source.matchAll(/^#{1,6} +([A-Za-z0-9 ]+?) *$/gm)].map(
        (m) => m[1] ?? '',
      );
      expect(headings.length).toBeGreaterThan(0);
      const safe = text(sanitizePandocHtml(html));
      for (const heading of headings.slice(0, 5)) expect(safe, heading).toContain(heading);
    });
  }

  it('a citation renders through citeproc with Pandoc 3.8.3 text', () => {
    const folder = join(FLAVORS, 'pandoc');
    const html = render(
      'markdown',
      readFileSync(join(folder, 'citations.md'), 'utf8'),
      folder,
      true,
    );
    const safe = text(sanitizePandocHtml(html));
    const expected = readFileSync(join(folder, 'expected/citations.txt'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.startsWith('Standard citation in brackets:') ||
          line.startsWith('Narrative citation:'),
      );
    expect(expected.length).toBe(2);
    for (const line of expected) expect(safe).toContain(line);
    expect(html).toContain('id="refs"');
  });

  it('without citeproc a citation stays as written', () => {
    const folder = join(FLAVORS, 'pandoc');
    const html = render('markdown', readFileSync(join(folder, 'citations.md'), 'utf8'), folder);
    expect(text(html)).not.toContain('(Smith 2020b)');
  });

  it('math comes out as MathML and the sanitizer keeps it', () => {
    const html = render('markdown', 'Inline $x^2$ and\n\n$$\\frac{a}{b}$$\n', ROOT);
    expect(html).toContain('<math');
    const safe = sanitizePandocHtml(html);
    expect(safe).toContain('<math');
    expect(safe).toContain('<mfrac');
  });

  it('raw script in the document is removed by the sanitizer, not run by Pandoc', () => {
    const html = render(
      'markdown',
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n',
      ROOT,
    );
    const safe = sanitizePandocHtml(html);
    expect(safe).not.toMatch(/<script|onerror/i);
  });

  it('a local image address is moved out of src (it is resolved through the asset path)', () => {
    const html = render('markdown', '![alt](pic.png)\n', ROOT);
    const safe = sanitizePandocHtml(html);
    expect(safe).toContain('data-wd-src="pic.png"');
    expect(safe).not.toMatch(/ src="pic\.png"/);
  });

  it('it never fetches: a remote image stays an address, nothing is embedded', () => {
    const html = render('markdown', '![x](https://example.invalid/a.png)\n', ROOT);
    expect(html).toContain('https://example.invalid/a.png');
    expect(html).not.toContain('data:image');
  });
});
