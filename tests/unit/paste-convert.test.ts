import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '@/editor/paste/convert';

const fx = (name: string) => readFileSync(resolve(__dirname, '../fixtures/paste', name), 'utf8');
/** Runs of spaces inside lines are the one allowed difference (fixture README). */
const norm = (text: string) => text.replace(/[ ]+/g, ' ').trim();

describe('htmlToMarkdown fixtures', () => {
  it('web page', () => {
    const base = fx('web.source-url.txt').trim();
    expect(norm(htmlToMarkdown(fx('web.html'), { flavor: 'gfm', baseUrl: base }))).toBe(
      norm(fx('web.expected.md')),
    );
  });
  it('word', () => {
    expect(norm(htmlToMarkdown(fx('word.html'), { flavor: 'gfm' }))).toBe(
      norm(fx('word.expected.md')),
    );
  });
  it('outlook', () => {
    expect(norm(htmlToMarkdown(fx('outlook.html'), { flavor: 'gfm' }))).toBe(
      norm(fx('outlook.expected.md')),
    );
  });
});

describe('htmlToMarkdown rules', () => {
  const md = (html: string, flavor: 'gfm' | 'commonmark' = 'gfm') =>
    htmlToMarkdown(html, { flavor, baseUrl: 'https://example.org/a/' });

  it('keeps strikethrough in GFM and drops it in CommonMark', () => {
    expect(md('<p>a <del>gone</del> b</p>')).toBe('a ~~gone~~ b');
    expect(md('<p>a <del>gone</del> b</p>', 'commonmark')).toBe('a gone b');
  });
  it('gives CommonMark an HTML table block', () => {
    const out = md(
      fx('web.html').split('<table>')[1] ? `<table>${fx('web.html').split('<table>')[1]}` : '',
      'commonmark',
    );
    expect(out.startsWith('<table>')).toBe(true);
    expect(out).toContain('<th>Name</th>');
    expect(out).not.toContain('|');
    expect(out).not.toMatch(/\n\s*\n/);
  });
  it('drops data images with a note and scripts entirely', () => {
    expect(md('<p><img src="data:image/png;base64,AAAA" alt="x"></p>')).toBe('*image not pasted*');
    const out = md('<p>ok</p><script>alert(1)</script><form><input name=a></form>');
    expect(out).toBe('ok');
  });
  it('removes javascript links but keeps their text', () => {
    expect(md('<p><a href="javascript:alert(1)">click</a></p>')).toBe('click');
  });
  it('turns code language classes into fence languages', () => {
    expect(md('<pre><code class="language-ts">let a = 1;\n</code></pre>')).toBe(
      '```ts\nlet a = 1;\n```',
    );
  });
  it('uses a dash rule and no trailing blank lines', () => {
    expect(md('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb');
  });
});
