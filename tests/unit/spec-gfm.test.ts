// DOMPurify, which the tagfilter tests exercise through the pipeline, needs jsdom.
// @vitest-environment jsdom
/**
 * The GFM extensions, written from the rules of the GitHub Flavored Markdown specification
 * (https://github.github.com/gfm/, version 0.29-gfm). Each test names the section it follows.
 * The official example file may be added later; the examples quoted here are the ones from
 * the text of the specification.
 *
 * Output differences that are by design: aligned table cells carry the classes `align-left`,
 * `align-center` and `align-right` (the specification shows an `align` attribute), and task list
 * markers are `span.task-checkbox` elements (the specification shows `input`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGfmPipeline } from '@/preview/packs/gfm';
import { normalizeHtml, parseHtml, plainHtml } from './preview-helpers';

const pipeline = createGfmPipeline();

/** The HTML the GFM pack makes for `markdown`, before sanitizing, in comparable form. */
function html(markdown: string): string {
  return normalizeHtml(plainHtml(pipeline.renderRaw(markdown)));
}

/** The sanitized HTML of all blocks. */
function sanitized(markdown: string): HTMLElement {
  return parseHtml(
    pipeline
      .render(markdown)
      .blocks.map((block) => block.html)
      .join(''),
  );
}

function expectHtml(markdown: string, expected: string): void {
  expect(html(markdown)).toBe(normalizeHtml(expected));
}

describe('GFM 4.10 Tables (extension)', () => {
  it('4.10: a header row, a delimiter row and body rows make a table', () => {
    expectHtml(
      '| foo | bar |\n| --- | --- |\n| baz | bim |\n',
      `<table><thead><tr><th>foo</th><th>bar</th></tr></thead>
       <tbody><tr><td>baz</td><td>bim</td></tr></tbody></table>`,
    );
  });

  it('4.10: the delimiter row sets the alignment, and outer pipes are optional', () => {
    expectHtml(
      '| abc | defghi |\n:-: | -----------:\nbar | baz\n',
      `<table><thead><tr><th class="align-center">abc</th><th class="align-right">defghi</th></tr></thead>
       <tbody><tr><td class="align-center">bar</td><td class="align-right">baz</td></tr></tbody></table>`,
    );
  });

  it('4.10: all three alignments and the default', () => {
    const table = sanitized('| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |\n');
    const cells = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.className);
    expect(cells).toEqual(['align-left', 'align-center', 'align-right', '']);
    const body = Array.from(table.querySelectorAll('tbody td')).map((cell) => cell.className);
    expect(body).toEqual(['align-left', 'align-center', 'align-right', '']);
    // No inline style attribute: the content security policy forbids them.
    expect(table.innerHTML).not.toMatch(/style=/i);
  });

  it('4.10: a pipe is part of a cell when it is escaped, also inside inline spans', () => {
    expectHtml(
      '| f\\|oo  |\n| ------ |\n| b `\\|` az |\n| b **\\|** im |\n',
      `<table><thead><tr><th>f|oo</th></tr></thead>
       <tbody><tr><td>b <code>|</code> az</td></tr><tr><td>b <strong>|</strong> im</td></tr></tbody></table>`,
    );
  });

  it('4.10: the table ends at the beginning of another block-level structure', () => {
    expectHtml(
      '| abc | def |\n| --- | --- |\n| bar | baz |\n> bar\n',
      `<table><thead><tr><th>abc</th><th>def</th></tr></thead>
       <tbody><tr><td>bar</td><td>baz</td></tr></tbody></table>
       <blockquote><p>bar</p></blockquote>`,
    );
  });

  it('4.10: the table ends at the first empty line; a line without pipes before it is a row', () => {
    expectHtml(
      '| abc | def |\n| --- | --- |\n| bar | baz |\nbar\n\nbar\n',
      `<table><thead><tr><th>abc</th><th>def</th></tr></thead>
       <tbody><tr><td>bar</td><td>baz</td></tr><tr><td>bar</td><td></td></tr></tbody></table>
       <p>bar</p>`,
    );
  });

  it('4.10: the header row must match the delimiter row in the number of cells', () => {
    expectHtml('| abc | def |\n| --- |\n| bar |\n', '<p>| abc | def |\n| --- |\n| bar |</p>');
  });

  it('4.10: body rows with fewer cells are padded, and excess cells are ignored', () => {
    expectHtml(
      '| abc | def |\n| --- | --- |\n| bar |\n| bar | baz | boo |\n',
      `<table><thead><tr><th>abc</th><th>def</th></tr></thead>
       <tbody><tr><td>bar</td><td></td></tr><tr><td>bar</td><td>baz</td></tr></tbody></table>`,
    );
  });

  it('4.10: a table can have a header row and no body', () => {
    expectHtml(
      '| abc | def |\n| --- | --- |\n',
      '<table><thead><tr><th>abc</th><th>def</th></tr></thead></table>',
    );
  });

  it('4.10: cells hold inline content: emphasis, code, links, images, strikethrough', () => {
    const table = sanitized(
      '| **bold** | `code` | [link](https://example.org) | ![alt](https://example.org/a.png) | ~~x~~ |\n' +
        '| --- | --- | --- | --- | --- |\n| a | b | c | d | e |\n',
    );
    const header = table.querySelector('thead tr');
    expect(header?.querySelector('th:nth-child(1) strong')?.textContent).toBe('bold');
    expect(header?.querySelector('th:nth-child(2) code')?.textContent).toBe('code');
    expect(header?.querySelector('th:nth-child(3) a')?.getAttribute('href')).toBe(
      'https://example.org',
    );
    expect(header?.querySelector('th:nth-child(4) img')?.getAttribute('alt')).toBe('alt');
    expect(header?.querySelector('th:nth-child(5) del')?.textContent).toBe('x');
  });
});

describe('GFM 5.3 Task list items (extension)', () => {
  /** [state, own text] of the task items of the sanitized HTML, in document order. */
  function tasks(markdown: string): Array<[string, string]> {
    return Array.from(sanitized(markdown).querySelectorAll('li.task-list-item')).map((item) => {
      const box = item.querySelector('.task-checkbox');
      let text = '';
      // The text after the box, up to a nested list.
      for (let node = box?.nextSibling; node; node = node.nextSibling) {
        if (node.nodeName === 'UL' || node.nodeName === 'OL') break;
        text += node.textContent ?? '';
      }
      return [box?.getAttribute('aria-checked') ?? 'none', text.trim()];
    });
  }

  it('5.3: [ ] is an unchecked and [x] a checked item', () => {
    expect(tasks('- [ ] foo\n- [x] bar\n')).toEqual([
      ['false', 'foo'],
      ['true', 'bar'],
    ]);
  });

  it('5.3: [X] is checked too, and items can be nested', () => {
    expect(tasks('- [x] foo\n  - [ ] bar\n  - [X] baz\n- [ ] bim\n')).toEqual([
      ['true', 'foo'],
      ['false', 'bar'],
      ['true', 'baz'],
      ['false', 'bim'],
    ]);
  });

  it('5.3: all list markers work: -, *, +, numbers with . and )', () => {
    const markdown = '- [ ] a\n\n* [x] b\n\n+ [ ] c\n\n1. [x] d\n\n2) [ ] e\n';
    expect(tasks(markdown).map(([state]) => state)).toEqual([
      'false',
      'true',
      'false',
      'true',
      'false',
    ]);
  });

  it('5.3: items in a loose list and in a block quote are task items', () => {
    expect(tasks('- [ ] one\n\n- [x] two\n').map(([state]) => state)).toEqual(['false', 'true']);
    expect(tasks('> - [x] quoted\n> - [ ] too\n').map(([state]) => state)).toEqual([
      'true',
      'false',
    ]);
  });

  it('5.3: the marker needs white space after it and content after that', () => {
    expect(tasks('- [ ]no space\n- [x]\n- [ ] \n- [x]  two spaces are fine\n')).toEqual([
      ['true', 'two spaces are fine'],
    ]);
  });

  it('5.3: only the exact markers count', () => {
    expect(tasks('- [] empty\n- [ x] a\n- [  ] two\n- [y] y\n- [-] dash\n')).toEqual([]);
  });

  it('5.3: the marker must open the first paragraph of the item', () => {
    expect(tasks('- text [ ] later\n- **[ ]** emphasized\n- `[ ]` code\n')).toEqual([]);
    expect(tasks('- first paragraph\n\n  [ ] second paragraph\n')).toEqual([]);
  });

  it('5.3: outside list items a marker is plain text', () => {
    expect(tasks('[ ] paragraph\n\n# [x] heading\n\n> [ ] quote\n')).toEqual([]);
    expect(tasks('| [ ] | b |\n| --- | --- |\n| [x] | d |\n')).toEqual([]);
  });

  it('5.3: the list that holds task items is marked, once', () => {
    const list = sanitized('- [ ] a\n- [x] b\n- plain\n').querySelector('ul');
    expect(list?.className).toBe('contains-task-list');
  });

  it('5.3: a task item that also has an ordinary item beside it keeps both', () => {
    const root = sanitized('- [ ] a\n- plain\n');
    expect(root.querySelectorAll('li')).toHaveLength(2);
    expect(root.querySelectorAll('li.task-list-item')).toHaveLength(1);
  });
});

describe('GFM 6.5 Strikethrough (extension)', () => {
  it('6.5: text between double tildes is struck through, and so is text between single tildes', () => {
    expectHtml(
      '~~Hi~~ Hello, ~there~ world!\n',
      '<p><del>Hi</del> Hello, <del>there</del> world!</p>',
    );
  });

  it('6.5: strikethrough does not run across paragraphs', () => {
    expectHtml('This ~~has a\n\nnew paragraph~~.\n', '<p>This ~~has a</p><p>new paragraph~~.</p>');
  });

  it('6.5: three or more tildes do not make strikethrough', () => {
    expectHtml('This will ~~~not~~~ strike.\n', '<p>This will ~~~not~~~ strike.</p>');
    expectHtml('and ~~~~four~~~~ here\n', '<p>and ~~~~four~~~~ here</p>');
  });

  it('6.5: both ends of a pair have the same number of tildes', () => {
    expectHtml('~~foo~\n', '<p>~~foo~</p>');
    expectHtml('~foo~~\n', '<p>~foo~~</p>');
    // Single tildes inside a double pair are left alone: only equal ends pair up.
    expectHtml('~~foo~ and ~bar~~\n', '<p><del>foo~ and ~bar</del></p>');
  });

  it('6.5: pairs can be nested and can sit inside words', () => {
    expectHtml('~~a ~b~ c~~\n', '<p><del>a <del>b</del> c</del></p>');
    expectHtml('a~b~c\n', '<p>a<del>b</del>c</p>');
  });

  it('6.5: tildes with white space on both sides stay as they are', () => {
    expectHtml('x ~ y ~ z\n', '<p>x ~ y ~ z</p>');
  });

  it('6.5: strikethrough holds other inline elements', () => {
    expectHtml(
      '~~**bold** and `code`~~\n',
      '<p><del><strong>bold</strong> and <code>code</code></del></p>',
    );
  });
});

describe('GFM 6.9 Autolinks (extension)', () => {
  it('6.9: www. followed by a domain is a link to http://', () => {
    expectHtml(
      'www.commonmark.org\n',
      '<p><a href="http://www.commonmark.org">www.commonmark.org</a></p>',
    );
  });

  it('6.9: after the domain, characters up to white space belong to the link', () => {
    expectHtml(
      'Visit www.commonmark.org/help for more information.\n',
      '<p>Visit <a href="http://www.commonmark.org/help">www.commonmark.org/help</a> for more information.</p>',
    );
  });

  it('6.9: trailing punctuation is not part of the link', () => {
    expectHtml(
      'Visit www.commonmark.org.\n\nVisit www.commonmark.org/a.b.\n',
      `<p>Visit <a href="http://www.commonmark.org">www.commonmark.org</a>.</p>
       <p>Visit <a href="http://www.commonmark.org/a.b">www.commonmark.org/a.b</a>.</p>`,
    );
  });

  it('6.9: ? ! . , : * _ ~ quotes and ; at the end are cut off, in the middle they stay', () => {
    const cases: Array<[string, string]> = [
      ['http://example.com/foo?', 'http://example.com/foo'],
      ['http://example.com/foo!', 'http://example.com/foo'],
      ['http://example.com/foo,', 'http://example.com/foo'],
      ['http://example.com/foo:', 'http://example.com/foo'],
      ['http://example.com/foo*', 'http://example.com/foo'],
      ['http://example.com/foo_', 'http://example.com/foo'],
      ['http://example.com/foo~', 'http://example.com/foo'],
      ['http://example.com/foo"', 'http://example.com/foo'],
      ['http://example.com/foo;', 'http://example.com/foo'],
      ['http://example.com/a?b=c&d=e', 'http://example.com/a?b=c&d=e'],
      ['http://example.com/a_b~c', 'http://example.com/a_b~c'],
    ];
    for (const [text, linked] of cases) {
      const link = sanitized(`See ${text}\n`).querySelector('a');
      expect(link?.textContent, text).toBe(linked);
      expect(link?.getAttribute('href'), text).toBe(linked);
    }
  });

  it('6.9: unmatched closing parentheses at the end are not part of the link', () => {
    expectHtml(
      `www.google.com/search?q=Markup+(business)

www.google.com/search?q=Markup+(business)))

(www.google.com/search?q=Markup+(business))

(www.google.com/search?q=Markup+(business)
`,
      `<p><a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a></p>
       <p><a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a>))</p>
       <p>(<a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a>)</p>
       <p>(<a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a></p>`,
    );
  });

  it('6.9: the parenthesis check applies only when the link ends in a parenthesis', () => {
    expectHtml(
      'www.google.com/search?q=(business))+ok\n',
      '<p><a href="http://www.google.com/search?q=(business))+ok">www.google.com/search?q=(business))+ok</a></p>',
    );
  });

  it('6.9: a trailing entity-like reference is not part of the link', () => {
    expectHtml(
      'www.google.com/search?q=commonmark&hl=en\n\nwww.google.com/search?q=commonmark&hl;\n',
      `<p><a href="http://www.google.com/search?q=commonmark&amp;hl=en">www.google.com/search?q=commonmark&amp;hl=en</a></p>
       <p><a href="http://www.google.com/search?q=commonmark">www.google.com/search?q=commonmark</a>&amp;hl;</p>`,
    );
  });

  it('6.9: < immediately ends a link', () => {
    expectHtml(
      'www.commonmark.org/he<lp\n',
      '<p><a href="http://www.commonmark.org/he">www.commonmark.org/he</a>&lt;lp</p>',
    );
  });

  it('6.9: http://, https:// and ftp:// followed by a domain are links as they are', () => {
    expectHtml(
      'http://commonmark.org\n\n(Visit https://encrypted.google.com/search?q=Markup+(business))\n',
      `<p><a href="http://commonmark.org">http://commonmark.org</a></p>
       <p>(Visit <a href="https://encrypted.google.com/search?q=Markup+(business)">https://encrypted.google.com/search?q=Markup+(business)</a>)</p>`,
    );
    expectHtml(
      'ftp://example.com/pub/file.txt\n',
      '<p><a href="ftp://example.com/pub/file.txt">ftp://example.com/pub/file.txt</a></p>',
    );
  });

  it('6.9: a URL with a scheme needs no period in its domain', () => {
    expectHtml(
      'http://localhost:8080/app\n',
      '<p><a href="http://localhost:8080/app">http://localhost:8080/app</a></p>',
    );
  });

  it('6.9: a bare domain is not a link, and neither is a scheme without a domain', () => {
    expect(
      sanitized('commonmark.org and example.com/path and http:// and https://\n').querySelector(
        'a',
      ),
    ).toBeNull();
  });

  it('6.9: no underscore may be in the last two segments of the domain', () => {
    expect(sanitized('www.example_.com\n').querySelector('a')).toBeNull();
    expect(sanitized('www.example.c_m\n').querySelector('a')).toBeNull();
    expect(sanitized('www.my_site.example.com\n').querySelector('a')?.getAttribute('href')).toBe(
      'http://www.my_site.example.com',
    );
  });

  it('6.9: www. links only at the start of the text or after white space or * _ ~ (', () => {
    for (const before of ['', ' ', '(', '*', '_', '~']) {
      const link = sanitized(`x${before}www.example.com\n`).querySelector('a');
      if (before === '') expect(link, 'x directly before').toBeNull();
      else
        expect(link?.getAttribute('href'), JSON.stringify(before)).toBe('http://www.example.com');
    }
    expect(sanitized('www.example.com\n').querySelector('a')).not.toBeNull();
  });

  it('6.9: the scheme is not a suffix of a longer word', () => {
    expect(sanitized('xhttp://example.com\n').querySelector('a')).toBeNull();
    expect(sanitized('1http://example.com\n').querySelector('a')?.getAttribute('href')).toBe(
      'http://example.com',
    );
  });

  it('6.9: an email address is a mailto link', () => {
    expectHtml('foo@bar.baz\n', '<p><a href="mailto:foo@bar.baz">foo@bar.baz</a></p>');
  });

  it('6.9: the local part has letters, digits and . - _ +, the domain at least one period', () => {
    expectHtml(
      "hello@mail+xyz.example isn't valid, but hello+xyz@mail.example is.\n",
      `<p>hello@mail+xyz.example isn't valid, but <a href="mailto:hello+xyz@mail.example">hello+xyz@mail.example</a> is.</p>`,
    );
    expect(sanitized('user@localhost\n').querySelector('a')).toBeNull();
  });

  it('6.9: an email address does not end in - or _, and a final period is cut off', () => {
    expectHtml(
      'a.b-c_d@a.b\n\na.b-c_d@a.b.\n\na.b-c_d@a.b-\n\na.b-c_d@a.b_\n',
      `<p><a href="mailto:a.b-c_d@a.b">a.b-c_d@a.b</a></p>
       <p><a href="mailto:a.b-c_d@a.b">a.b-c_d@a.b</a>.</p>
       <p>a.b-c_d@a.b-</p>
       <p>a.b-c_d@a.b_</p>`,
    );
  });

  it('6.9: links are not made inside links, code spans or code blocks', () => {
    const root = sanitized(
      '[www.example.com](https://other.example)\n\n`www.example.com`\n\n    www.example.com\n',
    );
    expect(root.querySelectorAll('a')).toHaveLength(1);
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://other.example');
  });

  it('6.9: angle-bracket autolinks of CommonMark keep working', () => {
    expectHtml(
      '<https://example.org> and <foo@bar.example.com>\n',
      '<p><a href="https://example.org">https://example.org</a> and <a href="mailto:foo@bar.example.com">foo@bar.example.com</a></p>',
    );
  });

  it('6.9: links work inside emphasis, headings and table cells', () => {
    expect(sanitized('*see www.example.com now*\n').querySelector('em a')).not.toBeNull();
    expect(sanitized('# www.example.com\n').querySelector('h1 a')).not.toBeNull();
    expect(sanitized('| a |\n| --- |\n| www.example.com |\n').querySelector('td a')).not.toBeNull();
  });
});

describe('GFM 6.11 Disallowed Raw HTML (extension), covered by the sanitizer', () => {
  const DISALLOWED = [
    'title',
    'textarea',
    'style',
    'xmp',
    'iframe',
    'noembed',
    'noframes',
    'script',
    'plaintext',
  ];

  it.each(DISALLOWED)('6.11: <%s> does not survive', (tag) => {
    const root = sanitized(`before\n\n<${tag}>inside</${tag}>\n\nafter\n`);
    expect(root.querySelector(tag), tag).toBeNull();
    expect(root.textContent).toContain('before');
    expect(root.textContent).toContain('after');
  });

  it('6.11: the example of the specification: the sanitizer removes the elements, others stay', () => {
    // The specification escapes the `<` of these tags. The sanitizer removes the elements
    // instead; what the browser would read as their raw text stays as text.
    const root = sanitized(
      '<strong> <title> <style> <em>\n\n<blockquote>\n  <xmp> is disallowed.  <XMP> is also disallowed.\n</blockquote>\n',
    );
    expect(root.querySelector('strong')).not.toBeNull();
    expect(root.querySelector('blockquote')).not.toBeNull();
    for (const tag of ['title', 'style', 'xmp']) expect(root.querySelector(tag), tag).toBeNull();
  });

  it('6.11: upper case and attributes do not help', () => {
    const root = sanitized(
      '<IFRAME src="https://example.org"></IFRAME>\n\n<SCRIPT SRC=x></SCRIPT>\n',
    );
    expect(root.querySelector('iframe, script')).toBeNull();
  });
});

// ---- The official examples (cmark-gfm test/spec.txt, GFM 0.29, CC BY-SA 4.0, test data only) ----

interface GfmExample {
  markdown: string;
  html: string;
  section: string;
  number: number;
  /** The word after `example` in the fence: table, strikethrough, autolink, tagfilter, disabled. */
  extension: string;
}

function parseGfmSpec(text: string): GfmExample[] {
  const found: GfmExample[] = [];
  let section = '';
  let number = 0;
  const body = text.replace(/\r\n?/g, '\n').replace(/^<!-- END TESTS -->(.|[\n])*/m, '');
  body.replace(
    /^`{32} example([^\n]*)\n([\s\S]*?)^\.\n([\s\S]*?)^`{32}$|^#{1,6} *(.*)$/gm,
    (_m, info: string, markdown: string, html: string, heading: string) => {
      if (heading) {
        section = heading;
      } else {
        number++;
        found.push({ markdown, html, section, number, extension: info.trim() });
      }
      return '';
    },
  );
  return found;
}

const gfmExamples = parseGfmSpec(
  readFileSync(resolve(__dirname, '../fixtures/gfm-spec/spec.txt'), 'utf8'),
).map((example) => ({
  ...example,
  markdown: example.markdown.replace(/→/g, '\t'),
  html: example.html.replace(/→/g, '\t'),
}));

/**
 * Extension examples where the preview differs from the official output on purpose, by example
 * number (the order of examples in the file), each with its reason.
 */
const GFM_SKIPPED = new Map<number, string>([]);

/** The official HTML for a task item uses `input`; the preview uses `span.task-checkbox`. */
function taskHtml(actual: string): string {
  return actual
    .replace(
      /<span class="task-checkbox" role="checkbox" aria-checked="(true|false)"[^>]*><\/span>/g,
      (_m, state: string) =>
        state === 'true'
          ? '<input checked="" disabled="" type="checkbox"> '
          : '<input disabled="" type="checkbox"> ',
    )
    .replace(/<(ul|li) class="[^"]*"/g, '<$1');
}

/** Tables: the preview marks alignment with classes where the official output has `align`. */
function alignHtml(expected: string): string {
  return expected.replace(/ align="(left|center|right)"/g, ' class="align-$1"');
}

const EXTENSIONS = ['table', 'strikethrough', 'autolink', 'tasklist', 'tagfilter'];

/** `disabled` examples of the file are the task list ones (the checkbox is rendered disabled). */
function extensionOf(example: GfmExample): string {
  return example.extension === 'disabled' ? 'tasklist' : example.extension;
}

describe('GFM official examples (spec 0.29, extension examples)', () => {
  const extensionExamples = gfmExamples.filter((example) =>
    EXTENSIONS.includes(extensionOf(example)),
  );

  it('finds the extension examples of the file', () => {
    const counts = Object.fromEntries(
      EXTENSIONS.map((name) => [
        name,
        extensionExamples.filter((example) => extensionOf(example) === name).length,
      ]),
    );
    expect(counts).toEqual({ table: 8, strikethrough: 2, autolink: 11, tasklist: 2, tagfilter: 1 });
  });

  for (const example of extensionExamples) {
    const kind = extensionOf(example);
    const name = `${kind} example ${example.number} (${example.section})`;
    const reason = GFM_SKIPPED.get(example.number);
    const run = () => {
      if (kind === 'tagfilter') {
        // The specification escapes the `<` of nine tags. The preview removes the elements with
        // the sanitizer instead, so this checks the sanitized output: the disallowed tags are not
        // elements, the others are left alone.
        const root = sanitized(example.markdown);
        for (const tag of ['title', 'style', 'xmp'])
          expect(root.querySelector(tag), tag).toBeNull();
        expect(root.querySelector('strong')).not.toBeNull();
        expect(root.querySelector('blockquote')).not.toBeNull();
        return;
      }
      let rendered = plainHtml(pipeline.renderRaw(example.markdown));
      if (kind === 'tasklist') rendered = taskHtml(rendered);
      const actual = normalizeHtml(rendered);
      let expected = example.html;
      if (kind === 'table') expected = alignHtml(expected);
      expect(actual, `${name}\n--- markdown\n${example.markdown}`).toBe(normalizeHtml(expected));
    };
    if (reason === undefined) it(name, run);
    else it.skip(`${name}: ${reason}`, run);
  }
});

/**
 * Core examples whose output changes with the GFM extensions, by example number, with the reason.
 */
const OLD_EMPHASIS =
  'GFM 0.29 is based on CommonMark 0.29, which merges directly nested strong emphasis; ' +
  'CommonMark 0.31 (which the CommonMark pack passes in full) nests it, and markdown-it follows 0.31';
const EXTENSION_AUTOLINK =
  'the autolink literal extension links text that plain CommonMark leaves alone (this is the GFM behavior)';
const CORE_DIFFERENCES = new Map<number, string>([
  [398, OLD_EMPHASIS],
  [426, OLD_EMPHASIS],
  [434, OLD_EMPHASIS],
  [435, OLD_EMPHASIS],
  [436, OLD_EMPHASIS],
  [473, OLD_EMPHASIS],
  [474, OLD_EMPHASIS],
  [475, OLD_EMPHASIS],
  [477, OLD_EMPHASIS],
  [610, EXTENSION_AUTOLINK],
  [614, EXTENSION_AUTOLINK],
  [616, EXTENSION_AUTOLINK],
  [619, EXTENSION_AUTOLINK],
  [620, EXTENSION_AUTOLINK],
]);

describe('GFM official examples (spec 0.29, core examples, against the GFM pack)', () => {
  // The core examples are the CommonMark examples of that version of the specification.
  const core = gfmExamples.filter((example) => example.extension === '');

  it('counts the core examples', () => {
    expect(core.length).toBe(648);
  });

  it('passes the core examples that no extension changes', () => {
    const failed: number[] = [];
    for (const example of core) {
      const actual = normalizeHtml(plainHtml(pipeline.renderRaw(example.markdown)));
      if (actual !== normalizeHtml(example.html)) failed.push(example.number);
    }
    expect(failed).toEqual([...CORE_DIFFERENCES.keys()]);
  });
});
