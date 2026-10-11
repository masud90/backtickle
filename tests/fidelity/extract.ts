/**
 * The structure that is compared: headings, paragraph texts,
 * list nesting, table cells and captions, citations and the reference list, cross-references,
 * footnotes, definition terms. Text is normalized: whitespace, quote style, no-break spaces.
 */

export interface Structure {
  titleBlock: string[];
  headings: string[];
  paragraphs: string[];
  lists: string[];
  tables: string[];
  captions: string[];
  citations: string[];
  references: string[];
  crossrefs: string[];
  footnotes: string[];
  footnoteCount: number;
  terms: string[];
  callouts: string[];
  tabs: string[];
}

export function norm(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/↩︎?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const own = (el: Element, selector: string) => [...el.querySelectorAll(selector)];

/** The text of an element without the parts that are not content (back-links, anchors). */
function textOf(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const junk of own(
    copy,
    '.footnote-back, a.footnote-back, a.footnote-backref, .anchorjs-link, .screen-reader-only, .visually-hidden, sup.footnote-ref, a.footnote-ref, .eq-number, .caption-label-hidden',
  )) {
    junk.remove();
  }
  // Math is compared as a token: Pandoc writes TeX in a span, Writedown writes MathML.
  for (const math of own(copy, 'span.math, math, .katex, .math-display, .math-inline')) {
    math.replaceWith(document.createTextNode(' MATH '));
  }
  return norm(copy.textContent);
}

function listSignature(list: Element): string {
  const items = [...list.children].filter((c) => c.tagName === 'LI');
  const parts = items.map((li) => {
    const copy = li.cloneNode(true) as Element;
    const nested = [...copy.children].filter((c) => /^(UL|OL|DL)$/.test(c.tagName));
    const inner = nested.map((n) => listSignature(n)).join('');
    for (const n of nested) n.remove();
    const task = copy.querySelector('input[type=checkbox]');
    const mark = task ? (task.hasAttribute('checked') ? '[x] ' : '[ ] ') : '';
    task?.remove();
    return `${mark}${textOf(copy)}${inner}`;
  });
  return `${list.tagName.toLowerCase()}(${parts.map((p) => `<${p}>`).join('')})`;
}

export function extract(html: string, options: { quarto?: boolean } = {}): Structure {
  const root = document.createElement('div');
  root.innerHTML = html.includes('<body')
    ? (/<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? html)
    : html;
  // Never content: scripts, styles, the table of contents of a standalone page.
  for (const junk of own(root, 'script, style, template, nav#TOC')) junk.remove();

  // The title block: Pandoc and Quarto write it as `header#title-block-header`, Writedown as
  // `header.wd-title-block`.
  const block = root.querySelector('header#title-block-header, header.wd-title-block');
  const titleBlock = block
    ? own(block, '.title, .subtitle, .author, .date, .abstract').map((el) => {
        const copy = el.cloneNode(true) as Element;
        for (const junk of own(copy, '.affiliation, .abstract-title')) junk.remove();
        return `${[...el.classList][0] ?? el.tagName.toLowerCase()}: ${norm(copy.textContent)}`;
      })
    : [];
  block?.remove();
  // Quarto's page wrapper: only the main content.
  const main = root.querySelector('main#quarto-document-content') ?? root;

  const footnoteBox = main.querySelector('.footnotes, section[role="doc-endnotes"]');
  const refsBox = main.querySelector('#refs');
  const insideNoise = (el: Element) =>
    (footnoteBox?.contains(el) ?? false) || (refsBox?.contains(el) ?? false);

  const headings = own(main, 'h1, h2, h3, h4, h5, h6')
    .filter((h) => !h.closest('.footnotes'))
    .map((h) => `${h.tagName.toLowerCase()} ${textOf(h)}`);

  const paragraphs = own(main, 'p, div.equation, div.math-display')
    .filter((p) => {
      if (insideNoise(p)) return false;
      if (p.classList.contains('callout-title')) return false;
      if (p.closest('figcaption, caption, dd, li, td, th')) return false;
      // A display equation inside an equation block is counted once, by the block.
      if (p.classList.contains('math-display') && p.closest('div.equation')) return false;
      return true;
    })
    .map((p) => {
      if (p.classList.contains('math-display')) return 'MATH';
      return p.querySelector('.critic, .critic-comment') ? `CRITIC ${textOf(p)}` : textOf(p);
    })
    .filter((t) => t !== '');

  const lists = own(main, 'ul, ol, dl')
    .filter((l) => !l.parentElement?.closest('ul, ol, dl') && !insideNoise(l))
    .filter((l) => l.tagName !== 'DL' && !l.classList.contains('nav-tabs'))
    .map(listSignature);

  const tables = own(main, 'table').map((table) =>
    own(table, 'tr')
      .map((tr) => own(tr, 'th, td').map(textOf).join(' | '))
      .join(' // '),
  );
  // In document order; a listing caption is a div here and a figcaption in Quarto.
  const captions = own(main, 'figcaption, table > caption, .listing-caption').map(textOf);

  const citations = own(main, 'span.citation').map(textOf);
  const references = own(main, '#refs .csl-entry, #refs .reference').map(textOf);

  const crossrefs = own(main, 'a.quarto-xref, a.xref, span.quarto-unresolved-ref').map(textOf);

  const footnoteItems = footnoteBox ? own(footnoteBox, 'li') : [];
  const footnotes = footnoteItems.map(textOf);

  const terms = own(main, 'dt').map(textOf);
  const callouts = (options.quarto ? own(main, '.callout') : []).map((c) => {
    const kind = [...c.classList].find((n) =>
      /^callout-(note|warning|important|tip|caution)$/.test(n),
    );
    const title = c.querySelector('.callout-title-container, .callout-title');
    return `${kind ?? '?'}: ${title ? textOf(title) : ''}`;
  });
  const tabs = [
    ...own(main, 'ul.nav-tabs a').map(textOf),
    ...own(main, 'section.tabset-panel').map((s) => norm(s.getAttribute('data-tab-title'))),
  ];
  return {
    titleBlock,
    callouts,
    tabs,
    headings,
    paragraphs,
    lists,
    tables,
    captions,
    citations,
    references,
    crossrefs,
    footnotes,
    footnoteCount: footnoteItems.length,
    terms,
  };
}
