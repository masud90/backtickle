import { describe, expect, it } from 'vitest';
import {
  findAll,
  firstFromBlock,
  matchesIn,
  rangeFor,
  stepIndex,
  textOf,
  textOfHtml,
} from '@/preview/find/model';

describe('find model: text of a block', () => {
  it('joins the text nodes and separates paragraphs and cells with a newline', () => {
    const html = '<div><p>One <em>two</em></p><table><tr><td>a</td><td>b</td></tr></table></div>';
    expect(textOfHtml(html, document)).toBe('One two\na\nb');
  });

  it('skips the Copy button', () => {
    const html =
      '<div><div class="code-card"><button class="code-copy"><span>Copy</span></button><pre><code>x = 1</code></pre></div></div>';
    expect(textOfHtml(html, document)).toBe('x = 1');
  });

  it('gives the same text for live elements and for their HTML', () => {
    const html = '<div><h2>Title <code>x</code></h2></div>';
    const live = document.createElement('div');
    live.innerHTML = html;
    expect(textOf(live).text).toBe(textOfHtml(html, document));
  });
});

describe('find model: matches', () => {
  it('finds every non-overlapping match with offsets', () => {
    expect(matchesIn('aaaa', 'aa', true)).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it('ignores case unless asked', () => {
    expect(matchesIn('Foo foo FOO', 'foo', false)).toHaveLength(3);
    expect(matchesIn('Foo foo FOO', 'foo', true)).toEqual([[4, 7]]);
  });

  it('treats the query as text, not a pattern', () => {
    expect(matchesIn('a.c abc (x)', '.', true)).toEqual([[1, 2]]);
    expect(matchesIn('a.c abc (x)', '(x)', true)).toEqual([[8, 11]]);
  });

  it('has no matches for an empty query', () => {
    expect(matchesIn('abc', '', true)).toEqual([]);
  });

  it('collects across blocks in order with the block index', () => {
    const found = findAll(['one two', '', 'two two'], 'two', true);
    expect(found).toEqual([
      { block: 0, start: 4, end: 7 },
      { block: 2, start: 0, end: 3 },
      { block: 2, start: 4, end: 7 },
    ]);
  });

  it('stops at the limit', () => {
    expect(findAll(['aaaa'], 'a', true, 2)).toHaveLength(2);
  });

  it('steps with wrapping', () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });

  it('picks the first match at or after a block', () => {
    const matches = [
      { block: 1, start: 0, end: 1 },
      { block: 4, start: 0, end: 1 },
    ];
    expect(firstFromBlock(matches, 2)).toBe(1);
    expect(firstFromBlock(matches, 9)).toBe(0);
  });
});

describe('find model: ranges', () => {
  it('maps offsets to text nodes, also across elements', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Hello <b>big</b> world</p>';
    const block = textOf(root);
    expect(rangeFor(document, block, 6, 15)?.toString()).toBe('big world');
    expect(rangeFor(document, block, 0, 5)?.toString()).toBe('Hello');
  });
});
