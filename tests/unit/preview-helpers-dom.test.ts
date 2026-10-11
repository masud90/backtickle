// @vitest-environment jsdom
/** The helpers for the shell: task and link events, the scroll map, and the trusted enhancements. */
import { describe, expect, it } from 'vitest';
import { BoundedCache } from '@/preview/cache';
import { enhanceBlock } from '@/preview/enhance';
import { classifyHref, linkFromEvent, taskLineFromEvent } from '@/preview/events';
import { hashString } from '@/preview/hash';
import { loadedParser, loadParser } from '@/preview/highlight';
import { classifyImageSource } from '@/preview/images';
import { applyBlockLines, applyInnerLines, hasInnerLines } from '@/preview/lines';
import { createGfmPipeline } from '@/preview/packs/gfm';
import { buildScrollMap } from '@/preview/scroll-map';
import { Slugger, slugify } from '@/preview/slug';

function html(markup: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = markup;
  document.body.append(root);
  return root;
}

describe('taskLineFromEvent', () => {
  const root = html(
    '<ul><li><span class="task-checkbox" data-task-line="7" tabindex="0">box</span> text<b id="in">x</b></li></ul><p id="other">p</p>',
  );
  const box = root.querySelector('.task-checkbox') as HTMLElement;

  it('gives the 0-based line for a click on the box', () => {
    const event = new MouseEvent('click', { bubbles: true });
    box.dispatchEvent(event);
    expect(taskLineFromEvent(event)).toBe(7);
  });

  it('gives it for the space key on the box, not for other keys', () => {
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
    box.dispatchEvent(space);
    expect(taskLineFromEvent(space)).toBe(7);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    box.dispatchEvent(enter);
    expect(taskLineFromEvent(enter)).toBeNull();
  });

  it('is null elsewhere, and for a box without a line', () => {
    const event = new MouseEvent('click', { bubbles: true });
    root.querySelector('#other')?.dispatchEvent(event);
    expect(taskLineFromEvent(event)).toBeNull();
    const bare = html('<span class="task-checkbox"></span>');
    const click = new MouseEvent('click', { bubbles: true });
    bare.firstElementChild?.dispatchEvent(click);
    expect(taskLineFromEvent(click)).toBeNull();
  });
});

describe('linkFromEvent and classifyHref', () => {
  const cases: Array<[string, 'external' | 'anchor' | 'document' | 'file']> = [
    ['https://example.org/a', 'external'],
    ['http://example.org', 'external'],
    ['mailto:a@b.example', 'external'],
    ['tel:+123', 'external'],
    ['#section-1', 'anchor'],
    ['second.md', 'document'],
    ['second.md#details', 'document'],
    ['../flavors/plain.MD', 'document'],
    ['notes/a%20b.markdown', 'document'],
    ['a.qmd', 'document'],
    ['a.Rmd', 'document'],
    ['a.mdx', 'document'],
    ['a.mmd', 'document'],
    ['a.txt', 'document'],
    ['files/report.pdf', 'file'],
    ['images/sample.png', 'file'],
    ['folder/', 'file'],
    ['noextension', 'file'],
    ['file:///Users/me/a.md', 'document'],
    ['file:///Users/me/a.pdf', 'file'],
  ];
  it.each(cases)('%s is %s', (href, kind) => {
    expect(classifyHref(href)).toBe(kind);
  });

  it('finds the link around the target and returns the href as written', () => {
    const root = html(
      '<p><a href="second.md#details"><em id="inner">text</em></a> and <span id="plain">x</span></p>',
    );
    root.addEventListener('click', (click) => click.preventDefault());
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    root.querySelector('#inner')?.dispatchEvent(event);
    expect(linkFromEvent(event)).toEqual({ href: 'second.md#details', kind: 'document' });
    const miss = new MouseEvent('click', { bubbles: true });
    root.querySelector('#plain')?.dispatchEvent(miss);
    expect(linkFromEvent(miss)).toBeNull();
  });

  it('ignores an anchor without href', () => {
    const root = html('<a id="x">no href</a>');
    const event = new MouseEvent('click', { bubbles: true });
    root.querySelector('#x')?.dispatchEvent(event);
    expect(linkFromEvent(event)).toBeNull();
  });
});

describe('buildScrollMap', () => {
  /** A container whose blocks have fixed boxes (jsdom has no layout). */
  function layout(blocks: Array<[line: number, end: number, top: number, bottom: number]>) {
    const container = document.createElement('article');
    container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    for (const [line, end, top, bottom] of blocks) {
      const element = document.createElement('div');
      element.setAttribute('data-line', String(line));
      element.setAttribute('data-end-line', String(end));
      element.getBoundingClientRect = () => ({ top: 100 + top, bottom: 100 + bottom }) as DOMRect;
      container.append(element);
    }
    return buildScrollMap(container);
  }

  const map = layout([
    [0, 0, 0, 40], // heading: line 0 to 1 (exclusive)
    [2, 5, 56, 156], // paragraph: lines 2..5, 100 px, a gap of 16 px before it
    [7, 7, 172, 200],
  ]);

  it('interpolates linearly inside a block, with fractional lines', () => {
    expect(map.offsetForLine(2)).toBe(56);
    expect(map.offsetForLine(4)).toBe(106);
    expect(map.offsetForLine(3.5)).toBeCloseTo(93.5);
    expect(map.lineForOffset(106)).toBeCloseTo(4);
    expect(map.lineForOffset(56 + 25)).toBeCloseTo(3);
  });

  it('interpolates across the gap between blocks', () => {
    // line 1 (end of the heading) is at 40, line 2 (start of the paragraph) is at 56
    expect(map.offsetForLine(1)).toBe(40);
    expect(map.lineForOffset(48)).toBeCloseTo(1.5);
  });

  it('clamps before the first and after the last block', () => {
    expect(map.offsetForLine(-5)).toBe(0);
    expect(map.offsetForLine(500)).toBe(200);
    expect(map.lineForOffset(-10)).toBe(0);
    expect(map.lineForOffset(5000)).toBe(8);
  });

  it('is monotonic in both directions', () => {
    let previous = -1;
    for (let line = 0; line <= 8; line += 0.25) {
      const offset = map.offsetForLine(line);
      expect(offset).toBeGreaterThanOrEqual(previous);
      previous = offset;
    }
    let previousLine = -1;
    for (let offset = 0; offset <= 200; offset += 3) {
      const line = map.lineForOffset(offset);
      expect(line).toBeGreaterThanOrEqual(previousLine);
      previousLine = line;
    }
  });

  it('round trips inside blocks', () => {
    for (const line of [0.5, 2.5, 3.75, 5.9, 7.3]) {
      expect(map.lineForOffset(map.offsetForLine(line))).toBeCloseTo(line, 5);
    }
  });

  it('clamps a block that is out of order (moved footnotes) so the map stays monotonic', () => {
    const footnotes = layout([
      [0, 1, 0, 40],
      [10, 12, 56, 100],
      [4, 5, 116, 140], // the footnote block, rendered last, with the lines of its definitions
    ]);
    let previous = -1;
    for (let offset = 0; offset <= 140; offset += 4) {
      const line = footnotes.lineForOffset(offset);
      expect(line).toBeGreaterThanOrEqual(previous);
      previous = line;
    }
    expect(footnotes.lineForOffset(135)).toBe(13);
  });

  it('an empty container maps to 0', () => {
    const empty = layout([]);
    expect(empty.offsetForLine(3)).toBe(0);
    expect(empty.lineForOffset(30)).toBe(0);
    expect(empty.blocks).toBe(0);
  });

  it('takes the offsets from the real positions of the blocks in a document', () => {
    expect(map.blocks).toBe(3);
  });
});

describe('lines of nested elements', () => {
  it('applyBlockLines writes the wrapper and the inner lines, and can be repeated', () => {
    const root = html(
      '<div class="wd-block"><ul><li data-wd-rl="0"><span data-wd-trl="0" class="task-checkbox"></span>a</li><li data-wd-rl="2">b</li></ul></div>',
    );
    const wrapper = root.firstElementChild as HTMLElement;
    applyBlockLines(wrapper, 10, 13, true);
    applyBlockLines(wrapper, 10, 13, true);
    expect(wrapper.getAttribute('data-line')).toBe('10');
    expect(wrapper.getAttribute('data-end-line')).toBe('13');
    expect(
      Array.from(wrapper.querySelectorAll('li')).map((li) => li.getAttribute('data-line')),
    ).toEqual(['10', '12']);
    expect(wrapper.querySelector('.task-checkbox')?.getAttribute('data-task-line')).toBe('10');
    applyInnerLines(wrapper, 20);
    expect(wrapper.querySelector('li')?.getAttribute('data-line')).toBe('20');
  });

  it('hasInnerLines tells which blocks have any', () => {
    expect(hasInnerLines('<p>x</p>')).toBe(false);
    expect(hasInnerLines('<li data-wd-rl="1">x</li>')).toBe(true);
  });
});

describe('enhanceBlock', () => {
  const context = { resolveImage: null, images: new Map<string, string>() };
  const render = (markdown: string) => {
    const pipeline = createGfmPipeline();
    const host = document.createElement('div');
    host.innerHTML = pipeline
      .render(markdown)
      .blocks.map((block) => block.html)
      .join('');
    return host;
  };

  it('fills alert icons with an inline SVG of the icon set', () => {
    const host = render('> [!WARNING]\n> careful\n');
    enhanceBlock(host, context);
    const icon = host.querySelector('.callout-icon');
    expect(icon?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('path')).not.toBeNull();
  });

  it('never takes an icon from the document: an unknown name stays empty', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<span class="callout-icon" data-icon="constructor"></span><span class="callout-icon" data-icon="x&quot;><script>"></span>';
    enhanceBlock(host, context);
    expect(host.querySelectorAll('svg')).toHaveLength(0);
    expect(host.querySelector('script')).toBeNull();
  });

  it('adds one Copy button to a code card, once', () => {
    const host = render('```js\nlet a;\n```\n');
    enhanceBlock(host, context);
    enhanceBlock(host, context);
    const buttons = host.querySelectorAll('.code-card-actions button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('Copy');
    expect(buttons[0]?.getAttribute('type')).toBe('button');
  });

  it('colors code with Lezer classes once the language is loaded, keeping the text exactly', async () => {
    const host = render('```typescript\nconst x: string = "a";\n```\n');
    const code = host.querySelector('code') as HTMLElement;
    const text = code.textContent;
    const work = enhanceBlock(host, context);
    await Promise.all(work);
    expect(loadedParser('typescript')).toBeTruthy();
    expect(code.querySelector('.tok-keyword')?.textContent).toBe('const');
    expect(code.querySelector('.tok-string')?.textContent).toBe('"a"');
    expect(code.textContent).toBe(text);
    // Loaded already: colors are applied at once, without waiting.
    const again = render('```typescript\nlet y = 1;\n```\n');
    expect(enhanceBlock(again, context)).toEqual([]);
    expect(again.querySelector('.tok-keyword')?.textContent).toBe('let');
  });

  it('uses aliases and extensions, and leaves unknown languages and no language plain', async () => {
    expect(await loadParser('py')).toBeTruthy();
    expect(await loadParser('definitely-not-a-language')).toBeNull();
    const host = render('```nonsense\nplain text\n```\n\n```\nalso plain\n```\n');
    await Promise.all(enhanceBlock(host, context));
    expect(host.querySelectorAll('[class^="tok-"]')).toHaveLength(0);
  });

  it('does not use fuzzy matching: "c++" style info words only match real names', async () => {
    expect(await loadParser('javas')).toBeNull();
  });

  it('fills math with MathML (KaTeX), error formulas without inline styles', async () => {
    const host = render('inline $E = mc^2$ and\n\n$$\\frac{1\n$$\n');
    await Promise.all(enhanceBlock(host, context));
    expect(host.querySelector('.math-inline math')).not.toBeNull();
    expect(host.querySelector('.math-inline annotation')?.textContent).toBe('E = mc^2');
    const bad = host.querySelector('.math-display');
    expect(bad?.classList.contains('math-error')).toBe(true);
    expect(bad?.querySelector('.katex-error')?.textContent).toBe('\\frac{1');
    expect(host.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('does not run KaTeX commands that need trust', async () => {
    const host = render(
      '$\\href{javascript:alert(1)}{x}$ $\\htmlClass{evil}{y}$ $\\includegraphics{a.png}$\n',
    );
    await Promise.all(enhanceBlock(host, context));
    expect(host.querySelector('a, img')).toBeNull();
    expect(host.querySelector('.evil')).toBeNull();
  });

  it('asks resolveImage for local images, caches the answer, and shows a placeholder on failure or a blocked source', async () => {
    const asked: string[] = [];
    const resolving = {
      resolveImage: async (source: string) => {
        asked.push(source);
        if (source.includes('missing')) throw new Error('not found');
        return `asset://localhost/${source}`;
      },
      images: new Map<string, string>(),
    };
    const host = render(
      '![ok](pics/a.png) ![gone](pics/missing.png) ![web](http://example.invalid/x.png) ![secure](https://example.org/s.png)\n',
    );
    await Promise.all(enhanceBlock(host, resolving));
    expect(asked).toEqual(['pics/a.png', 'pics/missing.png']);
    expect(host.querySelector('img[alt="ok"]')?.getAttribute('src')).toBe(
      'asset://localhost/pics/a.png',
    );
    expect(host.querySelector('img[alt="secure"]')?.getAttribute('src')).toBe(
      'https://example.org/s.png',
    );
    const placeholders = Array.from(host.querySelectorAll('.wd-image-missing')).map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(placeholders).toEqual(['Image not found: gone', 'Image not found: web']);
    // the same image again: no second request, the address is known
    const again = render('![ok](pics/a.png)\n');
    expect(await Promise.all(enhanceBlock(again, resolving))).toEqual([]);
    expect(asked).toHaveLength(2);
    expect(again.querySelector('img')?.getAttribute('src')).toBe('asset://localhost/pics/a.png');
  });

  it('without a resolver a local image shows the placeholder, named after the file when it has no alt text', () => {
    const host = render('![](pics/My%20Photo.png)\n');
    enhanceBlock(host, context);
    expect(host.querySelector('.wd-image-missing-text')?.textContent).toBe('My Photo.png');
  });

  it('images load lazily', () => {
    const host = render('![a](https://example.org/a.png)\n');
    enhanceBlock(host, context);
    expect(host.querySelector('img')?.getAttribute('loading')).toBe('lazy');
  });
});

describe('image sources', () => {
  const cases: Array<[string, 'keep' | 'local' | 'blocked']> = [
    ['https://example.org/a.png', 'keep'],
    ['HTTPS://EXAMPLE.ORG/a.png', 'keep'],
    ['data:image/png;base64,AAAA', 'keep'],
    ['data:image/svg+xml,%3Csvg%3E', 'keep'],
    ['data:text/html,x', 'blocked'],
    ['http://example.org/a.png', 'blocked'],
    ['//example.org/a.png', 'blocked'],
    ['ftp://example.org/a.png', 'blocked'],
    ['javascript:alert(1)', 'blocked'],
    ['', 'blocked'],
    ['pics/a.png', 'local'],
    ['./a.png', 'local'],
    ['../a.png', 'local'],
    ['/Users/me/a.png', 'local'],
    ['file:///Users/me/a.png', 'local'],
  ];
  it.each(cases)('%s is %s', (source, kind) => {
    expect(classifyImageSource(source)).toBe(kind);
  });
});

describe('small utilities', () => {
  it('slugify keeps letters, marks, digits, hyphens, underscores; spaces become hyphens', () => {
    expect(slugify('Hello, World! 2')).toBe('hello-world-2');
    expect(slugify('A  B')).toBe('a--b');
    expect(slugify('snake_case-and-kebab')).toBe('snake_case-and-kebab');
    expect(slugify('\u{1F389} Party')).toBe('-party');
    expect(slugify('')).toBe('');
  });

  it('Slugger numbers repeats and avoids ids that exist already', () => {
    const slugger = new Slugger();
    expect([slugger.slug('a'), slugger.slug('a'), slugger.slug('a-1'), slugger.slug('a')]).toEqual([
      'a',
      'a-1',
      'a-1-1',
      'a-2',
    ]);
  });

  it('hashString is stable, depends on every character and on the length', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i++) seen.add(hashString(`paragraph ${i}`));
    expect(seen.size).toBe(20000);
    expect(hashString('a')).not.toBe(hashString('a '));
  });

  it('BoundedCache drops the least recently used entries by count and by size', () => {
    const cache = new BoundedCache<string>({
      maxEntries: 3,
      maxSize: 10,
      sizeOf: (_k, v) => v.length,
    });
    cache.set('a', '1234');
    cache.set('b', '1234');
    cache.get('a'); // a is recent now
    cache.set('c', '1234'); // 12 > 10: b goes
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe('1234');
    expect(cache.totalSize).toBe(8);
    cache.set('big', 'x'.repeat(50)); // alone larger than the limit: kept, the rest goes
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
